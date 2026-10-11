-- #255 (M6 minors), edits, cancel and check-in: reminders an edit drops are named, Delete without
-- Gmail says the emails wait, the door counts only invites that went out, a retried update folds
-- into a newer one, and change lines start from what each person was last told.

-- When the person last received the meeting's details (invite or a notified update).
alter table public.meeting_invitees add column details_told_at timestamptz;
update public.meeting_invitees set details_told_at = sent_at where sent_at is not null;

-- When a reminder is due for this meeting (null: off, or none for this meeting). One rule for
-- sync_reminder_timers and edit_sent_meeting (spec §7.6).
create function private.reminder_due(p_meeting public.meetings, p_audience text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_meeting.status <> 'scheduled' or p_meeting.response_mode = 'announcement' or p_meeting.starts_at is null then null
    when p_audience = 'pending' then
      coalesce(p_meeting.response_deadline, p_meeting.starts_at) - pg_catalog.make_interval(hours => p_meeting.reminder_pending_hours)
    else p_meeting.starts_at - pg_catalog.make_interval(hours => p_meeting.reminder_going_hours)
  end
$$;

-- The change lines one person should read: each field's old value is what that person was last told
-- (the earliest change of it after their last details email), and fields that end where they began
-- for them are dropped (#255).
create function private.told_changes(p_changes jsonb, p_meeting uuid, p_told_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(c.key, pg_catalog.jsonb_build_array(o.old_value, c.value -> 1)), '{}'::jsonb)
  from pg_catalog.jsonb_each(coalesce(p_changes, '{}'::jsonb)) as c
  cross join lateral (
    select coalesce((
      select mc.changes -> c.key -> 0 from public.meeting_changes mc
      where p_told_at is not null and mc.meeting_id = p_meeting and mc.kind = 'edit'
        and mc.changes ? c.key and mc.changed_at > p_told_at
      order by mc.changed_at
      limit 1), c.value -> 0) as old_value
  ) o
  where o.old_value is distinct from c.value -> 1
$$;
revoke execute on function private.reminder_due(public.meetings, text), private.told_changes(jsonb, uuid, timestamptz)
  from public, anon, authenticated;
-- dispatch_reserve (service role) now folds a requeued update into a newer one.
grant execute on function private.merge_update_payload(jsonb, jsonb) to service_role;

-- sync_reminder_timers: latest body from 20261009235635_m6_edit_cancel.sql; the due time is
-- private.reminder_due.
create or replace function private.sync_reminder_timers(p_meeting uuid, p_keep_fired boolean default false)
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
    v_due := private.reminder_due(v, v_audience);
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

-- edit_sent_meeting: latest body from 20261009235635_m6_edit_cancel.sql; names reminders it drops,
-- and change lines start from what each person was last told.
create or replace function private.edit_sent_meeting(p_meeting uuid, p_fields jsonb, p_notify boolean, p_dry_run boolean)
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
  v_skipped text[];
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
      'calendar_only', 0, 'reconfirm', false, 'reminders_skipped', '[]'::jsonb);
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
  -- Reminders this edit moves into the past would be dropped without a word (#255): name them. A
  -- reminder already in the past before the edit isn't "dropped" by it, and one that already went
  -- out isn't either when only its settings change.
  v_skipped := array(
    select a.audience from pg_catalog.unnest(array['pending', 'going']) as a(audience)
    where v_keys && array['starts_at', 'response_deadline', 'reminder_pending_hours', 'reminder_going_hours']
      and private.reminder_due(v_new, a.audience) <= pg_catalog.now()
      and private.reminder_due(v_new, a.audience) is distinct from private.reminder_due(v_old, a.audience)
      and not (not (v_keys && array['starts_at', 'response_deadline']) and exists (
        select 1 from public.outbox_jobs j
        where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
          and j.status = 'done' and j.payload ->> 'audience' = a.audience)));
  select count(*) filter (where t.notify), count(*) filter (where not t.notify)
  into v_emails, v_calendar_only
  from private.update_targets(p_meeting, v_rule, v_calendar) t;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
      'calendar_only', v_calendar_only, 'reconfirm', v_time, 'reminders_skipped', pg_catalog.to_jsonb(v_skipped));
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
    -- A waiting update already starts from what the person was told; merging keeps its old values
    -- and takes this edit's new ones (a field moved back drops out in merge_update_payload).
    update public.outbox_jobs j
    set payload = private.merge_update_payload(j.payload,
          pg_catalog.jsonb_build_object('changes', v_visible, 'notify', t.notify, 'reconfirm', v_time)),
      run_after = v_due, last_error = null
    from targets t
    where j.invitee_id = t.invitee_id and j.kind = 'update' and j.status in ('pending', 'paused')
    returning j.invitee_id
  )
  -- A new update's change lines start from what the person was last told (#255).
  insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, payload, idempotency_key, run_after)
  select 'update', t.workspace_id, t.invitee_id, p_meeting,
    pg_catalog.jsonb_build_object(
      'changes', private.told_changes(v_visible, p_meeting, coalesce(ti.details_told_at, ti.invited_at)),
      'notify', t.notify, 'reconfirm', v_time),
    'update:' || t.invitee_id::text || ':' || gen_random_uuid()::text, v_due
  from targets t
  join public.meeting_invitees ti on ti.id = t.invitee_id
  where t.invitee_id not in (select merged.invitee_id from merged);

  return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
    'calendar_only', v_calendar_only, 'reconfirm', v_time, 'reminders_skipped', pg_catalog.to_jsonb(v_skipped));
end;
$$;

-- dispatch_finish: latest body from 20261009234223_m6_dispatch_kinds.sql; records when the person
-- last received the details.
create or replace function public.dispatch_finish(
  p_job uuid,
  p_outcome public.invitee_email_status,
  p_error text,
  p_token_hash text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitee uuid;
  v_kind public.job_kind;
  v_payload jsonb;
begin
  update public.outbox_jobs
  set status = case when p_outcome in ('sent', 'skipped') then 'done'::public.job_status else 'failed'::public.job_status end,
    last_error = p_error, locked_until = null
  where id = p_job and status = 'processing'
  returning invitee_id, kind, payload into v_invitee, v_kind, v_payload;
  if v_invitee is null then
    return;
  end if;
  -- Nothing went out: give the quota slot back (a skip after reserve sent nothing either).
  if p_outcome in ('failed', 'skipped') then
    delete from public.send_log s where s.job_id = p_job;
  end if;
  -- Every kind but the invite: record a calendar decision, never touch the invite's status.
  if v_kind <> 'invite' then
    if p_outcome in ('sent', 'unknown') and v_payload ? 'action' then
      update public.meeting_invitees
      set calendar_state = case when v_payload ->> 'action' = 'request'
                                then 'added'::public.calendar_state else 'none'::public.calendar_state end,
        calendar_sequence = (v_payload ->> 'sequence')::integer + 1
      where id = v_invitee;
    end if;
    -- A details email that went out: the person now knows the current details (#255).
    if v_kind = 'update' and p_outcome in ('sent', 'unknown') and coalesce((v_payload ->> 'notify')::boolean, false) then
      update public.meeting_invitees set details_told_at = pg_catalog.now() where id = v_invitee;
    end if;
    return;
  end if;
  update public.meeting_invitees
  set email_status = p_outcome,
    email_error = p_error,
    sent_at = case when p_outcome = 'sent' then pg_catalog.now() end,
    details_told_at = case when p_outcome in ('sent', 'unknown') then pg_catalog.now() else details_told_at end,
    token_hash = case when p_outcome = 'sent' then coalesce(token_hash, p_token_hash) else token_hash end
  where id = v_invitee;
end;
$$;

-- dispatch_claim: latest body from 20261011094523_m7_sheet_worker.sql; a lost invite may have reached
-- the person, so it counts as told.
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
      update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown',
        details_told_at = pg_catalog.now()
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
      and not private.job_held(j.kind, j.invitee_id)
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
      and not private.job_held(j.kind, j.invitee_id)
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

-- dispatch_reserve: latest body from 20261011114847_m7_minors_answers.sql.
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
    -- An update requeued (retry, quota) while a newer one waits: fold it into the newer one so the
    -- person gets one email with both changes (#255).
    if v_job.kind = 'update' then
      update public.outbox_jobs n
      set payload = private.merge_update_payload(v_job.payload, n.payload)
      where n.invitee_id = v_job.invitee_id and n.kind = 'update' and n.status in ('pending', 'paused') and n.id <> p_job;
      if found then
        update public.outbox_jobs set status = 'done', locked_until = null, last_error = 'superseded' where id = p_job;
        return pg_catalog.jsonb_build_object('kind', 'done');
      end if;
    end if;
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
      -- After unsubscribing, only their calendar event follows the meeting (moved or removed).
      -- Twin: calendarOnly in src/server/dispatch/run-dispatch.ts.
      when v_job.unsubscribed_at is not null and not (v_job.kind in ('update', 'cancel') and v_action is not null)
        then 'unsubscribed'
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
        and (v_job.unsubscribed_at is not null or not coalesce((v_job.payload ->> 'reconfirm')::boolean, false))
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
  if v_job.unsubscribed_at is not null then
    -- Only a calendar update or removal gets here (see v_skip): the email is the short calendar
    -- note, without the unsubscribe link.
    return pg_catalog.jsonb_build_object('kind', 'ok', 'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder', 'unsubscribed', true, 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  if v_action is not null then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  -- A reminder to someone who must reconfirm says so instead of "Please answer by…" (#255).
  return pg_catalog.jsonb_build_object('kind', 'ok', 'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder');
end;
$$;

-- meeting_results: latest body from 20261009235635_m6_edit_cancel.sql.
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
        -- Nudge emails the "not answered" audience; only that kind of reminder waiting counts (#255).
        private.reminder_waiting(i.id, 'pending') as reminder_waiting
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
      -- The door's "N of M": people whose invite went out, plus anyone marked by hand (#255).
      'check_in_total', (select count(*) from inv where inv.email_status in ('sent', 'unknown') or inv.marked),
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

-- delete_cancelled_meeting: latest body from 20261009235635_m6_edit_cancel.sql.
create or replace function private.delete_cancelled_meeting(p_meeting uuid)
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
  -- Waiting for Gmail (paused) is not "going out in a few minutes" (#255).
  if exists (select 1 from public.outbox_jobs j where j.meeting_id = p_meeting and j.kind = 'cancel' and j.status = 'paused')
    and v_meeting.starts_at > pg_catalog.now()
    and not exists (select 1 from public.outbox_jobs j
      where j.meeting_id = p_meeting and j.kind = 'cancel' and j.status in ('pending', 'processing')) then
    raise exception 'tn:cancel_emails_waiting' using errcode = 'P0001';
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
