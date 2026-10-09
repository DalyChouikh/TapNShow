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
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
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
    select i.id as invitee_id, i.workspace_id, i.calendar_state,
      case p_rule
        when 'all' then true
        when 'not_declined' then r.status is null or r.status not in ('absent', 'not_attending')
        else false
      end as notify
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and i.email_status in ('sent', 'unknown') and c.unsubscribed_at is null
  ) x
  where x.notify or (p_calendar and x.calendar_state = 'added')
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
  if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
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
  if v_keys && array['starts_at', 'response_deadline', 'reminder_pending_hours', 'reminder_going_hours'] then
    perform private.sync_reminder_timers(p_meeting);
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
  update public.meeting_invitees
  set email_status = 'skipped', email_error = 'meeting_cancelled'
  where meeting_id = p_meeting and email_status = 'queued';

  with inserted as (
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, idempotency_key)
    select 'cancel', i.workspace_id, i.id, p_meeting, 'cancel:' || i.id::text
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    where i.meeting_id = p_meeting and i.email_status in ('sent', 'unknown') and c.unsubscribed_at is null
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
    where j.meeting_id = p_meeting and j.kind = 'cancel' and j.status in ('pending', 'processing', 'paused')
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
      -- The time before the latest move while this person is still to reconfirm (the answer page
      -- strikes it through).
      'previous_starts_at', case when r.needs_reconfirmation then (
        select (mc.changes -> 'starts_at' ->> 0)::timestamptz
        from public.meeting_changes mc
        where mc.meeting_id = m.id and mc.kind = 'edit' and mc.changes ? 'starts_at'
        order by mc.changed_at desc
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
        am.invitee_id is not null as marked
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
        'remindable', count(*) filter (where inv.email_status in ('sent', 'unknown') and inv.reachable_contact
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
