-- M6 edits, cancel and delete of a sent meeting (spec §7.5); reconfirmation (spec §7.3); the
-- results reads learn "to reconfirm", the Nudge count and check-in marks.

create extension if not exists unaccent with schema extensions;

-- Lower case without accents, so "sarra" finds "Sârra" (the roster search does the same on the
-- device). unaccent() is only STABLE; naming the dictionary makes this wrapper safe as IMMUTABLE.
create function private.fold(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text))
$$;

create function private.like_contains(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- chr(92) is the backslash (like's default escape), spelled so no string-literal setting changes it.
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p_text,
    pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92)),
    '%', pg_catalog.chr(92) || '%'), '_', pg_catalog.chr(92) || '_') || '%'
$$;

-- Who gets an update (spec §7.5 Recipients): rule 'all', 'not_declined' or 'none'; calendar
-- holders also get one when the event's content changed (`p_calendar`).
create function private.update_targets(p_meeting uuid, p_rule text, p_calendar boolean)
returns table (invitee_id uuid, workspace_id uuid, notify boolean)
language sql
stable
set search_path = ''
as $$
  select x.invitee_id, x.workspace_id, x.notify
  from (
    select i.id as invitee_id, i.workspace_id,
      i.calendar_state = 'added' or exists (
        select 1 from public.outbox_jobs j
        where j.invitee_id = i.id and j.kind = 'calendar_confirm' and j.status = 'processing'
      ) as calendar,
      case p_rule
        when 'all' then true
        when 'not_declined' then r.status is null or r.status not in ('absent', 'not_attending')
        else false
      end as notify
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and c.unsubscribed_at is null
      -- Invited, or being invited right now: the dispatcher renders a claimed invite from the
      -- details it read at claim time, so those people need the update too (review of Task 6).
      and (i.email_status in ('sent', 'unknown')
        or (i.email_status = 'queued' and exists (
          select 1 from public.outbox_jobs j
          where j.invitee_id = i.id and j.kind = 'invite' and j.status = 'processing')))
  ) x
  where x.notify or (p_calendar and x.calendar)
$$;

-- One pending update per person (spec §8): a later edit keeps the oldest "old" and the newest
-- "new" of each field, drops fields that ended where they started, and ORs notify / reconfirm.
create function private.merge_update_payload(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'changes', coalesce((
      select pg_catalog.jsonb_object_agg(k.key, pg_catalog.jsonb_build_array(k.old_value, k.new_value))
      from (
        select t.key,
          coalesce(p_old -> 'changes' -> t.key -> 0, p_new -> 'changes' -> t.key -> 0) as old_value,
          coalesce(p_new -> 'changes' -> t.key -> 1, p_old -> 'changes' -> t.key -> 1) as new_value
        from pg_catalog.jsonb_object_keys(coalesce(p_old -> 'changes', '{}'::jsonb) || coalesce(p_new -> 'changes', '{}'::jsonb)) as t(key)
      ) k
      where k.old_value is distinct from k.new_value
    ), '{}'::jsonb),
    'notify', coalesce((p_old ->> 'notify')::boolean, false) or coalesce((p_new ->> 'notify')::boolean, false),
    'reconfirm', coalesce((p_old ->> 'reconfirm')::boolean, false) or coalesce((p_new ->> 'reconfirm')::boolean, false)
  )
$$;

revoke execute on function private.fold(text), private.like_contains(text), private.update_targets(uuid, text, boolean),
  private.merge_update_payload(jsonb, jsonb)
  from public, anon, authenticated;

-- Edits that email people are limited per organizer (security review: repeated edits must not
-- flood members' inboxes; quick edits also merge into one email per person, spec §8).
insert into private.app_limits (name, value) values ('meeting_email_edits_per_user_per_hour', 10);

-- hit_user_rate_limit: latest body from 20261007203357_m4_meetings.sql plus 'meeting_edit_email'.
create or replace function private.hit_user_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit_name text := case p_action
    when 'import' then 'imports_per_user_per_hour'
    when 'import_preview' then 'import_previews_per_user_per_hour'
    when 'contact_add' then 'contact_adds_per_user_per_hour'
    when 'meeting_create' then 'meetings_per_user_per_hour'
    when 'meeting_people_add' then 'meeting_people_adds_per_user_per_hour'
    when 'meeting_edit_email' then 'meeting_email_edits_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

create function private.edit_sent_meeting(p_meeting uuid, p_fields jsonb, p_notify boolean, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Field groups: TS twins in src/config/meeting-edit.ts (a DB test compares them).
  c_editable constant text[] := array['title', 'agenda_md', 'starts_at', 'duration_minutes', 'timezone',
    'location_mode', 'location_text', 'online_text', 'meeting_url', 'response_deadline', 'reason_required',
    'comments_enabled', 'footer_note', 'reminder_pending_hours', 'reminder_going_hours'];
  c_visible constant text[] := array['title', 'starts_at', 'duration_minutes', 'timezone', 'location_mode',
    'location_text', 'online_text', 'meeting_url', 'agenda_md', 'response_deadline', 'footer_note'];
  c_schedule constant text[] := array['starts_at', 'duration_minutes'];
  c_place constant text[] := array['location_mode', 'location_text', 'online_text', 'meeting_url'];
  c_calendar constant text[] := array['title', 'agenda_md', 'starts_at', 'duration_minutes', 'location_mode',
    'location_text', 'online_text', 'meeting_url'];
  v_old public.meetings;
  v_new public.meetings;
  v_old_json jsonb;
  v_new_json jsonb;
  v_changes jsonb;
  v_visible jsonb;
  v_keys text[];
  v_problem text;
  v_rule text;
  v_time boolean;
  v_calendar boolean;
  v_due timestamptz;
  v_emails integer;
  v_calendar_only integer;
begin
  if p_fields is null or p_dry_run is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_fields) k where k <> all (c_editable)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  select * into v_old from public.meetings m where m.id = p_meeting for update;
  if v_old.id is null or not private.is_member(v_old.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_old.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_old.status <> 'scheduled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_old.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;

  v_new := pg_catalog.jsonb_populate_record(v_old, p_fields);
  if not pg_catalog.isfinite(v_new.starts_at)
    or (v_new.response_deadline is not null and not pg_catalog.isfinite(v_new.response_deadline)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if private.meeting_incomplete(v_new) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_new.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  if v_new.response_mode = 'announcement' and v_new.response_deadline is not null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  -- A deadline that already passed may stay as it is (spec Review Focus 3); a changed one must
  -- follow the full rule, and the start may never move to before it.
  if v_new.response_deadline is distinct from v_old.response_deadline then
    v_problem := private.response_deadline_problem(v_new.response_deadline, v_new.starts_at);
  elsif v_new.response_deadline is not null and v_new.response_deadline >= v_new.starts_at then
    v_problem := 'deadline_after_start';
  end if;
  if v_problem is not null then
    raise exception 'tn:%', v_problem using errcode = 'P0001';
  end if;

  v_old_json := pg_catalog.to_jsonb(v_old);
  v_new_json := pg_catalog.to_jsonb(v_new);
  select pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_array(v_old_json -> k, v_new_json -> k)),
    pg_catalog.array_agg(k)
  into v_changes, v_keys
  from pg_catalog.unnest(c_editable) as k
  where (v_old_json -> k) is distinct from (v_new_json -> k);
  if v_keys is null then
    return pg_catalog.jsonb_build_object('changed', false, 'changes', '{}'::jsonb, 'emails', 0,
      'calendar_only', 0, 'reconfirm', false);
  end if;
  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_visible
  from pg_catalog.jsonb_each(v_changes) e where e.key = any (c_visible);

  v_time := 'starts_at' = any (v_keys);
  v_calendar := v_keys && c_calendar;
  v_rule := case
    when v_keys && c_schedule then 'all'
    when v_keys && c_place then 'not_declined'
    when coalesce(p_notify, false) and v_keys && c_visible then 'all'
    else 'none'
  end;
  select count(*) filter (where t.notify), count(*) filter (where not t.notify)
  into v_emails, v_calendar_only
  from private.update_targets(p_meeting, v_rule, v_calendar) t;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
      'calendar_only', v_calendar_only, 'reconfirm', v_time);
  end if;
  if v_emails + v_calendar_only > 0 and not private.hit_user_rate_limit('meeting_edit_email') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;

  update public.meetings set
    title = v_new.title, agenda_md = v_new.agenda_md, starts_at = v_new.starts_at,
    duration_minutes = v_new.duration_minutes, timezone = v_new.timezone, location_mode = v_new.location_mode,
    location_text = v_new.location_text, online_text = v_new.online_text, meeting_url = v_new.meeting_url,
    response_deadline = v_new.response_deadline, reason_required = v_new.reason_required,
    comments_enabled = v_new.comments_enabled, footer_note = v_new.footer_note,
    reminder_pending_hours = v_new.reminder_pending_hours, reminder_going_hours = v_new.reminder_going_hours,
    ics_sequence = ics_sequence + 1
  where id = p_meeting;
  if v_time then
    update public.responses set needs_reconfirmation = true
    where meeting_id = p_meeting and workspace_id = v_old.workspace_id;
  end if;
  -- A move reschedules both reminders, even one that already went out (owner decision); a change of
  -- reminder settings alone never sends a reminder that already went out again.
  if v_keys && array['starts_at', 'response_deadline'] then
    perform private.sync_reminder_timers(p_meeting, false);
  elsif v_keys && array['reminder_pending_hours', 'reminder_going_hours'] then
    perform private.sync_reminder_timers(p_meeting, true);
  end if;
  insert into public.meeting_changes (workspace_id, meeting_id, kind, changes, notified, changed_by)
  values (v_old.workspace_id, p_meeting, 'edit', v_changes, v_rule <> 'none', auth.uid());

  v_due := pg_catalog.now() + pg_catalog.make_interval(secs => private.app_limit('calendar_confirm_delay_seconds'));
  with targets as materialized (
    select * from private.update_targets(p_meeting, v_rule, v_calendar)
  ), merged as (
    update public.outbox_jobs j
    set payload = private.merge_update_payload(j.payload,
          pg_catalog.jsonb_build_object('changes', v_visible, 'notify', t.notify, 'reconfirm', v_time)),
      run_after = v_due, last_error = null
    from targets t
    where j.invitee_id = t.invitee_id and j.kind = 'update' and j.status in ('pending', 'paused')
    returning j.invitee_id
  )
  insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, payload, idempotency_key, run_after)
  select 'update', t.workspace_id, t.invitee_id, p_meeting,
    pg_catalog.jsonb_build_object('changes', v_visible, 'notify', t.notify, 'reconfirm', v_time),
    'update:' || t.invitee_id::text || ':' || gen_random_uuid()::text, v_due
  from targets t
  where t.invitee_id not in (select merged.invitee_id from merged);

  return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
    'calendar_only', v_calendar_only, 'reconfirm', v_time);
end;
$$;

create function private.cancel_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_count integer;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_meeting.status <> 'scheduled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;

  update public.meetings set status = 'cancelled', cancelled_at = pg_catalog.now(), ics_sequence = ics_sequence + 1
  where id = p_meeting;
  -- Nothing else of this meeting goes out: unsent invites, updates, reminders (timers included)
  -- and calendar emails. The cancellation below carries any calendar removal.
  update public.outbox_jobs j
  set status = 'done', last_error = 'meeting_cancelled', locked_until = null
  where j.status in ('pending', 'paused')
    and j.kind in ('invite', 'update', 'reminder', 'calendar_confirm')
    and (j.meeting_id = p_meeting
         or j.invitee_id in (select i.id from public.meeting_invitees i where i.meeting_id = p_meeting));
  -- An invite already handed to Gmail still goes out: that person gets the cancellation too.
  update public.meeting_invitees i
  set email_status = 'skipped', email_error = 'meeting_cancelled'
  where i.meeting_id = p_meeting and i.email_status = 'queued'
    and not exists (
      select 1 from public.outbox_jobs j
      where j.invitee_id = i.id and j.kind = 'invite' and j.status = 'processing' and j.send_started_at is not null);

  with inserted as (
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, idempotency_key)
    select 'cancel', i.workspace_id, i.id, p_meeting, 'cancel:' || i.id::text
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    where i.meeting_id = p_meeting and c.unsubscribed_at is null
      and (i.email_status in ('sent', 'unknown')
        or (i.email_status = 'queued' and exists (
          select 1 from public.outbox_jobs j
          where j.invitee_id = i.id and j.kind = 'invite' and j.status = 'processing'
            and j.send_started_at is not null)))
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  insert into public.meeting_changes (workspace_id, meeting_id, kind, changes, notified, changed_by)
  values (v_meeting.workspace_id, p_meeting, 'cancel',
    pg_catalog.jsonb_build_object('status', pg_catalog.jsonb_build_array('scheduled', 'cancelled')),
    v_count > 0, auth.uid());
  return pg_catalog.jsonb_build_object('emails', v_count);
end;
$$;

create function private.delete_cancelled_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status <> 'cancelled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.outbox_jobs j
    where j.meeting_id = p_meeting and j.kind = 'cancel'
      -- Waiting for Gmail after the start: those would be dropped anyway (too late to tell anyone).
      and (j.status in ('pending', 'processing') or (j.status = 'paused' and v_meeting.starts_at > pg_catalog.now()))
  ) then
    raise exception 'tn:cancel_emails_pending' using errcode = 'P0001';
  end if;
  delete from public.meetings where id = p_meeting;
end;
$$;

revoke execute on function private.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  private.cancel_meeting(uuid), private.delete_cancelled_meeting(uuid) from public, anon;
grant execute on function private.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  private.cancel_meeting(uuid), private.delete_cancelled_meeting(uuid) to authenticated;

create function public.edit_sent_meeting(
  p_meeting uuid, p_fields jsonb, p_notify boolean default false, p_dry_run boolean default false
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.edit_sent_meeting(p_meeting, p_fields, p_notify, p_dry_run) $$;
create function public.cancel_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_meeting(p_meeting) $$;
create function public.delete_cancelled_meeting(p_meeting uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_cancelled_meeting(p_meeting) $$;
revoke execute on function public.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  public.cancel_meeting(uuid), public.delete_cancelled_meeting(uuid) from public, anon;
grant execute on function public.edit_sent_meeting(uuid, jsonb, boolean, boolean),
  public.cancel_meeting(uuid), public.delete_cancelled_meeting(uuid) to authenticated;

-- Reconfirmation (spec §7.3): the same answer saved again while flagged confirms it (one history
-- row); any new answer clears the flag. Latest body from 20261008181825_m5_responses.sql.
create or replace function public.token_submit_response(
  p_token_hash text,
  p_status public.response_status,
  p_delay_minutes integer default null,
  p_reason text default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v record;
  v_delay smallint;
  v_reason text;
  v_comment text;
  v_after boolean;
  v_old public.responses;
  v_new public.responses;
begin
  select i.id as invitee_id, i.workspace_id, i.meeting_id, m.status, m.starts_at, m.response_mode,
    m.delay_options, m.reason_required, m.comments_enabled, m.response_deadline
  into v
  from public.meeting_invitees i
  join public.meetings m on m.id = i.meeting_id
  where i.token_hash = p_token_hash
  for update of i;
  if v.invitee_id is null then
    return null;
  end if;
  if v.status <> 'scheduled' or v.starts_at is null or v.starts_at <= pg_catalog.now() then
    raise exception 'tn:answers_closed' using errcode = 'P0001';
  end if;
  if (v.response_mode = 'attendance' and p_status not in ('attending', 'late', 'absent'))
    or (v.response_mode = 'rsvp' and p_status not in ('attending', 'not_attending'))
    or v.response_mode = 'announcement' then
    raise exception 'tn:invalid_choice' using errcode = 'P0001';
  end if;
  if p_status = 'late' then
    if p_delay_minutes is null or not (p_delay_minutes::smallint = any (v.delay_options)) then
      raise exception 'tn:delay_required' using errcode = 'P0001';
    end if;
    v_delay := p_delay_minutes::smallint;
  end if;
  v_reason := case when p_status = 'attending' then '' else pg_catalog.btrim(coalesce(p_reason, '')) end;
  if p_status <> 'attending' and v.reason_required and v_reason = '' then
    raise exception 'tn:reason_required' using errcode = 'P0001';
  end if;
  v_comment := case when v.comments_enabled then pg_catalog.btrim(coalesce(p_comment, '')) else '' end;
  v_after := v.response_deadline is not null and pg_catalog.now() > v.response_deadline;

  select * into v_old from public.responses r where r.invitee_id = v.invitee_id;
  if v_old.id is not null
    and v_old.status = p_status
    and v_old.delay_minutes is not distinct from v_delay
    and v_old.reason = v_reason
    and v_old.comment = v_comment then
    if v_old.needs_reconfirmation then
      -- "Yes, still going" after a time change (spec §7.3): the same answer, confirmed again.
      update public.responses set needs_reconfirmation = false, updated_at = pg_catalog.now()
      where id = v_old.id
      returning * into v_new;
      insert into public.response_history (workspace_id, meeting_id, invitee_id, response_id, status, delay_minutes,
        reason, comment, after_deadline)
      values (v.workspace_id, v.meeting_id, v.invitee_id, v_new.id, v_new.status, v_new.delay_minutes, v_new.reason,
        v_new.comment, v_new.after_deadline);
    else
      v_new := v_old;
    end if;
  else
    -- Any new answer also settles a pending reconfirmation.
    insert into public.responses (workspace_id, meeting_id, invitee_id, status, delay_minutes, reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, p_status, v_delay, v_reason, v_comment, v_after)
    on conflict (invitee_id) do update
      set status = excluded.status, delay_minutes = excluded.delay_minutes, reason = excluded.reason,
        comment = excluded.comment, after_deadline = excluded.after_deadline, needs_reconfirmation = false,
        updated_at = pg_catalog.now()
    returning * into v_new;
    insert into public.response_history (workspace_id, meeting_id, invitee_id, response_id, status, delay_minutes,
      reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, v_new.id, v_new.status, v_new.delay_minutes, v_new.reason,
      v_new.comment, v_new.after_deadline);
    perform private.refresh_calendar_job(v.invitee_id, v.workspace_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'status', v_new.status, 'delay_minutes', v_new.delay_minutes, 'reason', v_new.reason,
    'comment', v_new.comment, 'after_deadline', v_new.after_deadline,
    'responded_at', v_new.responded_at, 'updated_at', v_new.updated_at,
    'needs_reconfirmation', v_new.needs_reconfirmation
  );
end;
$$;

-- token_invitee: latest body from 20261008181825_m5_responses.sql, plus the reconfirmation fields.
create or replace function public.token_invitee(p_token_hash text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'invitee_id', i.id,
    'workspace_name', w.name,
    'masked_email', private.mask_email(c.email),
    'full_name', c.full_name,
    'unsubscribed', c.unsubscribed_at is not null,
    'reported', c.unsubscribed_via is not distinct from 'report',
    'calendar_requested', i.calendar_requested_at is not null,
    'meeting', pg_catalog.jsonb_build_object(
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone, 'duration_minutes', m.duration_minutes,
      'location_mode', m.location_mode, 'location_text', m.location_text, 'online_text', m.online_text,
      'meeting_url', m.meeting_url, 'agenda_md', m.agenda_md,
      'status', m.status,
      -- While this person is still to reconfirm: the time they answered for, i.e. before the first
      -- move after their answer (the answer page strikes it through).
      'previous_starts_at', case when r.needs_reconfirmation then (
        select (mc.changes -> 'starts_at' ->> 0)::timestamptz
        from public.meeting_changes mc
        where mc.meeting_id = m.id and mc.kind = 'edit' and mc.changes ? 'starts_at'
          and mc.changed_at > r.updated_at
        order by mc.changed_at
        limit 1) end
    ),
    'answers', pg_catalog.jsonb_build_object(
      'response_mode', m.response_mode, 'delay_options', m.delay_options, 'reason_required', m.reason_required,
      'comments_enabled', m.comments_enabled, 'footer_note', m.footer_note, 'response_deadline', m.response_deadline
    ),
    'answer', case when r.id is null then null else pg_catalog.jsonb_build_object(
      'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
      'after_deadline', r.after_deadline, 'responded_at', r.responded_at, 'updated_at', r.updated_at,
      'needs_reconfirmation', r.needs_reconfirmation
    ) end
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.responses r on r.invitee_id = i.id
  where i.token_hash = p_token_hash;
$$;

-- meeting_results: latest body from 20261008215854_m5_results_reads.sql, plus "to reconfirm", the
-- Nudge and Cancel counts, check-ins and the last nudge.
create or replace function private.meeting_results(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meeting record;
begin
  select m.id, m.workspace_id, m.response_mode, m.last_nudged_at, m.last_nudged_count into v_meeting from public.meetings m where m.id = p_meeting;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return (
    with inv as materialized (
      select i.id, i.email_status, i.calendar_requested_at, r.status as answer,
        coalesce(r.needs_reconfirmation, false) as reconfirm,
        c.unsubscribed_at is null as reachable_contact,
        am.invitee_id is not null as marked,
        exists (
          select 1 from public.outbox_jobs o
          where o.invitee_id = i.id and o.kind = 'reminder' and o.status in ('pending', 'paused', 'processing')
        ) as reminder_waiting
      from public.meeting_invitees i
      join public.contacts c on c.id = i.contact_id
      left join public.responses r on r.invitee_id = i.id
      left join public.attendance_marks am on am.invitee_id = i.id
      where i.meeting_id = p_meeting
    ), jobs as materialized (
      select j.status, j.run_after
      from public.outbox_jobs j
      join inv on inv.id = j.invitee_id
      where j.kind = 'invite' and j.status in ('paused', 'pending')
    )
    select pg_catalog.jsonb_build_object(
      'response_mode', v_meeting.response_mode,
      'emails', (select pg_catalog.jsonb_build_object(
        'total', count(*),
        'queued', count(*) filter (where inv.email_status = 'queued'),
        'sent', count(*) filter (where inv.email_status = 'sent'),
        'skipped', count(*) filter (where inv.email_status = 'skipped'),
        'failed', count(*) filter (where inv.email_status = 'failed'),
        'unknown', count(*) filter (where inv.email_status = 'unknown')) from inv),
      -- People still to reconfirm after a time change count only as "to reconfirm" (spec §7.5).
      'answers', (select pg_catalog.jsonb_build_object(
        'attending', count(*) filter (where inv.answer = 'attending' and not inv.reconfirm),
        'late', count(*) filter (where inv.answer = 'late' and not inv.reconfirm),
        'absent', count(*) filter (where inv.answer = 'absent' and not inv.reconfirm),
        'not_attending', count(*) filter (where inv.answer = 'not_attending' and not inv.reconfirm),
        'to_reconfirm', count(*) filter (where inv.reconfirm),
        'no_reply', count(*) filter (where inv.answer is null and inv.email_status in ('sent', 'unknown')),
        'calendar_requested', count(*) filter (where inv.calendar_requested_at is not null),
        -- Who a Nudge would email (same rule as the reminders) and who a Cancel would email.
        'remindable', count(*) filter (where v_meeting.response_mode <> 'announcement'
          and inv.email_status in ('sent', 'unknown') and inv.reachable_contact and not inv.reminder_waiting
          and private.reminder_eligible('pending', inv.answer, inv.reconfirm)),
        'reachable', count(*) filter (where inv.email_status in ('sent', 'unknown') and inv.reachable_contact)) from inv),
      'checked_in', (select count(*) from inv where inv.marked),
      'nudge', pg_catalog.jsonb_build_object(
        'last_at', v_meeting.last_nudged_at,
        'last_count', v_meeting.last_nudged_count,
        'next_at', v_meeting.last_nudged_at
          + pg_catalog.make_interval(hours => private.app_limit('nudge_interval_hours'))),
      'paused', (select count(*) from jobs where jobs.status = 'paused'),
      'resumes_at', (select min(jobs.run_after) from jobs
        where jobs.status = 'pending' and jobs.run_after > pg_catalog.now() + interval '2 minutes'),
      'sender_state', (select case when c.id is null then 'missing' when c.status = 'broken' then 'broken' else 'ok' end
        from public.workspaces w left join public.google_connections c on c.id = w.sender_connection_id
        where w.id = v_meeting.workspace_id)
    )
  );
end;
$$;

-- meeting_people gains the to_reconfirm filter, a search and the check-in mark (a new signature).
drop function public.meeting_people(uuid, text, text, uuid, integer);
drop function private.meeting_people(uuid, text, text, uuid, integer);
create function private.meeting_people(
  p_meeting uuid, p_filter text, p_after_name text, p_after_id uuid, p_limit integer, p_search text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_rows jsonb;
  v_count integer;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_filter not in ('all', 'attending', 'late', 'absent', 'not_attending', 'no_reply', 'not_delivered', 'to_reconfirm')
    or p_limit not between 1 and 100 or pg_catalog.char_length(p_search) > 120 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select i.id as invitee_id, c.id as contact_id, c.full_name, c.email, c.is_adhoc, lower(c.full_name) as sort_name,
      i.email_status, i.email_error, i.sent_at,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
        'needs_reconfirmation', r.needs_reconfirmation) end as answer,
      case when am.invitee_id is null then null else pg_catalog.jsonb_build_object(
        'actual', am.actual, 'marked_at', am.marked_at, 'marked_by_name', mp.display_name) end as mark
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    left join public.attendance_marks am on am.invitee_id = i.id
    left join public.profiles mp on mp.user_id = am.marked_by
    where i.meeting_id = p_meeting and i.workspace_id = v_workspace
      and case p_filter
        when 'all' then true
        when 'no_reply' then r.id is null and i.email_status in ('sent', 'unknown')
        when 'not_delivered' then i.email_status in ('failed', 'skipped')
        when 'to_reconfirm' then coalesce(r.needs_reconfirmation, false)
        else r.status::text = p_filter and not r.needs_reconfirmation
      end
      -- Names ignore case and accents ("sarra" finds "Sârra"); % and _ are plain characters.
      and (p_search is null
           or private.fold(c.full_name) like private.like_contains(private.fold(p_search))
           or c.email like private.like_contains(pg_catalog.lower(p_search)))
      and (p_after_id is null or (lower(c.full_name), i.id) > (p_after_name, p_after_id))
    order by lower(c.full_name), i.id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.sort_name, page.invitee_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e order by t.n) from pg_catalog.jsonb_array_elements(v_rows)
      with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;

create function public.meeting_people(
  p_meeting uuid, p_filter text default 'all', p_after_name text default null, p_after_id uuid default null,
  p_limit integer default 50, p_search text default null
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_people(p_meeting, p_filter, p_after_name, p_after_id, p_limit, p_search) $$;
revoke execute on function private.meeting_people(uuid, text, text, uuid, integer, text),
  public.meeting_people(uuid, text, text, uuid, integer, text) from public, anon;
grant execute on function private.meeting_people(uuid, text, text, uuid, integer, text),
  public.meeting_people(uuid, text, text, uuid, integer, text) to authenticated;

-- Review of Task 6 ----------------------------------------------------------------------------

-- Reminder timers after an edit: a move reschedules them; a change of reminder settings alone keeps
-- a reminder that already went out (new signature; send_meeting's one-argument call still resolves).
drop function private.sync_reminder_timers(uuid);
create function private.sync_reminder_timers(p_meeting uuid, p_keep_fired boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.meetings;
  v_audience text;
  v_due timestamptz;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  foreach v_audience in array array['pending', 'going'] loop
    -- After a change of reminder settings alone, a reminder that already went out stays sent.
    continue when p_keep_fired and exists (
      select 1 from public.outbox_jobs j
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status = 'done' and j.payload ->> 'audience' = v_audience);
    v_due := case
      when v.status <> 'scheduled' or v.response_mode = 'announcement' or v.starts_at is null then null
      when v_audience = 'pending' then
        coalesce(v.response_deadline, v.starts_at) - pg_catalog.make_interval(hours => v.reminder_pending_hours)
      else v.starts_at - pg_catalog.make_interval(hours => v.reminder_going_hours)
    end;
    if v_due is null or v_due <= pg_catalog.now() then
      delete from public.outbox_jobs j
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status in ('pending', 'paused') and j.payload ->> 'audience' = v_audience;
    else
      update public.outbox_jobs j set run_after = v_due, status = 'pending', last_error = null
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status in ('pending', 'paused') and j.payload ->> 'audience' = v_audience;
      if not found then
        insert into public.outbox_jobs (kind, workspace_id, meeting_id, payload, idempotency_key, run_after)
        values ('reminder', v.workspace_id, p_meeting, pg_catalog.jsonb_build_object('audience', v_audience),
          'reminder:' || p_meeting::text || ':' || v_audience || ':' || gen_random_uuid()::text, v_due);
      end if;
    end if;
  end loop;
end;
$$;
revoke execute on function private.sync_reminder_timers(uuid, boolean) from public, anon, authenticated;

-- dispatch_claim: latest body from 20261009234223_m6_dispatch_kinds.sql; an update or cancellation
-- waits while the person's invite is still being sent (it was rendered with the old details).
create or replace function public.dispatch_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.google_connections;
  v_lease interval := pg_catalog.make_interval(secs => p_lease_seconds);
  v_rows integer;
  v_lost record;
begin
  -- Due reminder timers become per-person jobs before anything is claimed (spec §7.6).
  perform private.fan_out_reminders();

  -- A lease expired after the email may have reached Gmail: never resend (at most once). An invite
  -- becomes "Delivery unknown"; any email carrying a calendar decision (in payload) is recorded as
  -- sent.
  for v_lost in
    update public.outbox_jobs j
    set status = 'failed', last_error = 'delivery_unknown', locked_until = null
    where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is not null
    returning j.invitee_id, j.kind, j.payload
  loop
    if v_lost.kind = 'invite' then
      update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown'
      where i.id = v_lost.invitee_id;
    elsif v_lost.kind <> 'invite' and v_lost.payload ? 'action' then
      update public.meeting_invitees i
      set calendar_state = case when v_lost.payload ->> 'action' = 'request'
                                then 'added'::public.calendar_state else 'none'::public.calendar_state end,
        calendar_sequence = (v_lost.payload ->> 'sequence')::integer + 1
      where i.id = v_lost.invitee_id;
    end if;
  end loop;

  update public.outbox_jobs j
  set status = 'pending', locked_until = null, run_id = null
  where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is null;

  update public.outbox_jobs j
  set status = 'paused', last_error = 'no_sender'
  from public.workspaces w
  left join public.google_connections c on c.id = w.sender_connection_id
  where j.workspace_id = w.id and j.status = 'pending' and j.run_after <= pg_catalog.now()
    and j.invitee_id is not null and (c.id is null or c.status <> 'active');

  select c.* into v_connection
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id and c.status = 'active'
  left join public.sender_leases l on l.google_sub = c.google_sub
  where j.status = 'pending' and j.run_after <= pg_catalog.now() and j.invitee_id is not null
    -- An update or a cancellation waits for that person's invite, still being sent.
      and not (j.kind in ('update', 'cancel') and exists (
        select 1 from public.meeting_invitees qi where qi.id = j.invitee_id and qi.email_status = 'queued'))
    and (l.google_sub is null or l.locked_until < pg_catalog.now() or l.run_id = p_run)
  order by j.run_after, j.created_at
  limit 1;
  if v_connection.id is null then
    return null;
  end if;

  insert into public.sender_leases (google_sub, run_id, locked_until)
  values (v_connection.google_sub, p_run, pg_catalog.now() + v_lease)
  on conflict (google_sub) do update
    set run_id = excluded.run_id, locked_until = excluded.locked_until
    where public.sender_leases.locked_until < pg_catalog.now() or public.sender_leases.run_id = excluded.run_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return null;
  end if;

  with picked as (
    select j.id
    from public.outbox_jobs j
    join public.workspaces w on w.id = j.workspace_id
    where w.sender_connection_id = v_connection.id and j.status = 'pending' and j.run_after <= pg_catalog.now()
      and j.invitee_id is not null
      -- An update or a cancellation waits for that person's invite, still being sent.
      and not (j.kind in ('update', 'cancel') and exists (
        select 1 from public.meeting_invitees qi where qi.id = j.invitee_id and qi.email_status = 'queued'))
    order by j.run_after, j.created_at
    limit p_limit
    for update of j skip locked
  )
  update public.outbox_jobs j
  set status = 'processing', attempts = j.attempts + 1, run_id = p_run, locked_until = pg_catalog.now() + v_lease
  from picked where j.id = picked.id;

  return pg_catalog.jsonb_build_object(
    'connection', pg_catalog.jsonb_build_object(
      'id', v_connection.id,
      'user_id', v_connection.user_id,
      'google_sub', v_connection.google_sub,
      'google_email', v_connection.google_email,
      'refresh_token_encrypted', v_connection.refresh_token_encrypted
    ),
    'jobs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'job_id', j.id,
          'kind', j.kind,
          'attempts', j.attempts,
          'payload', j.payload,
          'invitee_id', i.id,
          'workspace_id', w.id,
          'workspace_name', w.name,
          'contact', pg_catalog.jsonb_build_object('full_name', c.full_name, 'email', c.email),
          'meeting', pg_catalog.jsonb_build_object(
            'id', m.id, 'title', m.title, 'agenda_md', m.agenda_md, 'starts_at', m.starts_at,
            'duration_minutes', m.duration_minutes, 'timezone', m.timezone, 'location_mode', m.location_mode,
            'location_text', m.location_text, 'online_text', m.online_text, 'meeting_url', m.meeting_url,
            'response_mode', m.response_mode, 'response_deadline', m.response_deadline, 'footer_note', m.footer_note,
            'ics_uid', m.ics_uid,
            'thread_id', case when m.thread_connection_id = v_connection.id then m.gmail_thread_id end,
            'root_message_id', case when m.thread_connection_id = v_connection.id then m.gmail_root_message_id end
          )
        )
        order by m.id, j.created_at
      )
      from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      join public.meetings m on m.id = i.meeting_id
      join public.contacts c on c.id = i.contact_id
      join public.workspaces w on w.id = j.workspace_id
      where j.run_id = p_run and j.status = 'processing' and w.sender_connection_id = v_connection.id
    ), '[]'::jsonb)
  );
end;
$$;

-- dispatch_reserve: latest body from 20261009234223_m6_dispatch_kinds.sql, plus "not invited".
create or replace function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_wanted boolean;
  v_action text;
  v_skip text;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.kind, j.status, j.workspace_id, j.invitee_id, j.payload, c.google_sub, m.status as meeting_status,
    m.starts_at, m.response_mode, ct.unsubscribed_at, i.calendar_state, i.calendar_sequence,
    i.calendar_requested_at, i.email_status, r.status as answer, r.needs_reconfirmation
  into v_job
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id
  join public.meeting_invitees i on i.id = j.invitee_id
  join public.meetings m on m.id = i.meeting_id
  join public.contacts ct on ct.id = i.contact_id
  left join public.responses r on r.invitee_id = i.id
  where j.id = p_job
  for update of j, i;
  if v_job.id is null or v_job.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;

  if v_job.kind = 'invite' then
    if v_job.unsubscribed_at is not null or v_job.meeting_status <> 'scheduled' or v_job.starts_at <= pg_catalog.now() then
      update public.outbox_jobs set status = case when v_job.starts_at <= pg_catalog.now() then 'failed'::public.job_status else 'done'::public.job_status end,
        locked_until = null,
        last_error = case
          when v_job.unsubscribed_at is not null then 'unsubscribed'
          when v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
          else 'meeting_started' end
      where id = p_job;
      update public.meeting_invitees set
        email_status = case when v_job.unsubscribed_at is null and v_job.meeting_status = 'scheduled' then 'failed'::public.invitee_email_status else 'skipped'::public.invitee_email_status end,
        email_error = case
          when v_job.unsubscribed_at is not null then 'unsubscribed'
          when v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
          else 'meeting_started' end
      where id = v_job.invitee_id;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
  else
    -- Should this person have the event in their calendar right now? (spec §8 calendar_confirm)
    v_wanted := v_job.meeting_status = 'scheduled'
      and (v_job.answer in ('attending', 'late')
           or (v_job.response_mode = 'announcement' and v_job.calendar_requested_at is not null));
    v_action := case v_job.kind
      when 'calendar_confirm' then case
        when v_wanted and v_job.calendar_state = 'none' then 'request'
        when not v_wanted and v_job.calendar_state = 'added' then 'cancel' end
      when 'update' then case when v_wanted and v_job.calendar_state = 'added' then 'request' end
      when 'cancel' then case when v_job.calendar_state = 'added' then 'cancel' end
    end;
    v_skip := case
      when v_job.unsubscribed_at is not null then 'unsubscribed'
      when v_job.starts_at <= pg_catalog.now() then 'meeting_started'
      -- An update or cancellation for someone whose invite never went out (it failed, was skipped).
      when v_job.kind in ('update', 'cancel') and v_job.email_status not in ('sent', 'unknown') then 'not_invited'
      when v_job.kind = 'cancel' and v_job.meeting_status <> 'cancelled' then 'not_cancelled'
      when v_job.kind in ('update', 'reminder') and v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
      when v_job.kind = 'reminder'
        and not private.reminder_eligible(v_job.payload ->> 'audience', v_job.answer, v_job.needs_reconfirmation)
        then 'not_eligible'
      when v_job.kind = 'calendar_confirm' and v_action is null then 'nothing_to_send'
      -- Twin of updateHasSomethingToSay (src/server/dispatch/run-dispatch.ts): changes that cancelled
      -- out say nothing, even to a calendar holder; without a calendar part, only a notified person
      -- gets an email.
      when v_job.kind = 'update'
        and coalesce(v_job.payload -> 'changes', '{}'::jsonb) = '{}'::jsonb
        and not coalesce((v_job.payload ->> 'reconfirm')::boolean, false)
        then 'nothing_to_send'
      when v_job.kind = 'update' and v_action is null
        and not coalesce((v_job.payload ->> 'notify')::boolean, false)
        then 'nothing_to_send'
    end;
    if v_skip is not null then
      update public.outbox_jobs set status = 'done', locked_until = null, last_error = v_skip where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('send:' || v_job.google_sub));
  select count(*), min(s.sent_at) into v_count, v_oldest
  from public.send_log s where s.google_sub = v_job.google_sub and s.sent_at > pg_catalog.now() - interval '24 hours';
  if v_count >= private.app_limit('gmail_sends_per_day') then
    v_retry := v_oldest + interval '24 hours';
  else
    select count(*), min(s.sent_at) into v_count, v_oldest
    from public.send_log s where s.google_sub = v_job.google_sub and s.sent_at > pg_catalog.now() - interval '1 minute';
    if v_count >= private.app_limit('gmail_sends_per_minute') then
      v_retry := v_oldest + interval '1 minute';
    end if;
  end if;
  if v_retry is not null then
    update public.outbox_jobs
    set status = 'pending', attempts = greatest(attempts - 1, 0), run_after = v_retry, locked_until = null,
      run_id = null, last_error = 'quota'
    where id = p_job;
    return pg_catalog.jsonb_build_object('kind', 'quota', 'retry_at', v_retry);
  end if;

  insert into public.send_log (google_sub, workspace_id, job_id) values (v_job.google_sub, v_job.workspace_id, p_job)
  on conflict (job_id) where job_id is not null do nothing;
  update public.outbox_jobs
  set send_started_at = pg_catalog.now(),
    -- Drop a decision left by an earlier attempt, or dispatch_finish would record it (Task 3 review).
    payload = case when v_action is not null
      then payload || pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence)
      else payload - 'action' - 'sequence' end
  where id = p_job;
  -- The personal links must work in any email that may have gone out, including one whose outcome
  -- ends up "unknown" (the token is derived from the invitee id, so storing it early is safe).
  if p_token_hash is not null then
    update public.meeting_invitees set token_hash = coalesce(token_hash, p_token_hash) where id = v_job.invitee_id;
  end if;
  if v_action is not null then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;

-- "Not my group" reports outlive a deleted meeting (spec §6: platform admins review them in M9).
alter table public.abuse_reports add column contact_id uuid references public.contacts (id) on delete set null;
create index abuse_reports_contact_idx on public.abuse_reports (contact_id);
update public.abuse_reports a set contact_id = i.contact_id from public.meeting_invitees i where i.id = a.invitee_id;
alter table public.abuse_reports alter column invitee_id drop not null;
alter table public.abuse_reports drop constraint abuse_reports_invitee_id_fkey;
alter table public.abuse_reports add constraint abuse_reports_invitee_id_fkey
  foreign key (invitee_id) references public.meeting_invitees (id) on delete set null;

-- token_unsubscribe: latest body from 20261008071625_m4_tokens.sql; a report keeps the contact.
create or replace function public.token_unsubscribe(p_token_hash text, p_via public.unsubscribe_via)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitee uuid;
  v_workspace uuid;
  v_contact uuid;
begin
  update public.contacts c
  set unsubscribed_at = coalesce(c.unsubscribed_at, pg_catalog.now()),
    unsubscribed_via = case when p_via = 'report' then 'report'::public.unsubscribe_via
                            else coalesce(c.unsubscribed_via, 'link'::public.unsubscribe_via) end
  from public.meeting_invitees i
  where i.token_hash = p_token_hash and c.id = i.contact_id
  returning i.id, i.workspace_id, i.contact_id into v_invitee, v_workspace, v_contact;
  if v_invitee is null then
    return false;
  end if;
  if p_via = 'report' then
    insert into public.abuse_reports (workspace_id, invitee_id, contact_id) values (v_workspace, v_invitee, v_contact)
    on conflict (invitee_id) do nothing;
  end if;
  return true;
end;
$$;
