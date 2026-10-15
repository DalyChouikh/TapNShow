-- M8 minors (#319). Latest bodies: hit_user_rate_limit and contacts_of from
-- 20261014115306_m8_member_reads.sql, delete_account from 20261014151133_m8_account_deletion.sql,
-- push_unsubscribe, push_enqueue and dispatch_finish from 20261014160152_m8_push.sql.

insert into private.app_limits (name, value) values ('push_unsubscribes_per_user_per_hour', 60);

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
    when 'sheet_retry' then 'sheet_retries_per_user_per_hour'
    when 'google_connect' then 'google_connects_per_user_per_hour'
    when 'check_in_mark' then 'check_in_marks_per_user_per_hour'
    when 'check_in_rest' then 'check_in_rests_per_user_per_hour'
    when 'invite_link' then 'invite_links_per_user_per_hour'
    when 'answers_download' then 'answer_downloads_per_user_per_hour'
    when 'account_delete' then 'account_deletions_per_user_per_hour'
    when 'push_subscribe' then 'push_subscribes_per_user_per_hour'
    when 'push_unsubscribe' then 'push_unsubscribes_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- THE matching rule: a contact belongs to an account when its email equals the confirmed email of
-- a non-SSO account (only those emails are unique: auth's users_email_partial_key). Auth stores
-- emails lower-cased, like contacts, so the plain equality uses contacts_email_idx. Twin, the other
-- way round (contact → accounts): private.push_enqueue, with the same three conditions.
-- A function with its own search_path is never inlined, so `rows` tells the planner the truth
-- (one contact per workspace the person is in); the default 1,000 made callers hash every invitee.
create or replace function private.contacts_of(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 3
as $$
  select c.id
  from auth.users u
  join public.contacts c on c.email = u.email
  where u.id = p_user and u.is_sso_user = false and u.email_confirmed_at is not null
$$;

-- Turn off reminders for this browser: only the caller's own row, rate limited (spec §11). The
-- device unsubscribes itself either way, so a refused call never keeps notifications coming.
create or replace function private.push_unsubscribe(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('push_unsubscribe') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
end;
$$;

-- A sent email's notifications: one row per device of the person the invite matches. The contact
-- → account direction of the matching rule; twin: private.contacts_of (account → contacts). The
-- composite foreign key (contact_id, workspace_id) already keeps the contact in the invite's
-- workspace. Each email kind is mapped here, the one place that decides which emails notify; a
-- kind with no notification (calendar_confirm, or one added later) enqueues nothing instead of
-- failing the step that records a sent email. Unsubscribed people get none (spec §7.16 / #254).
create or replace function private.push_enqueue(p_job uuid, p_invitee uuid, p_kind public.job_kind, p_audience text)
returns void
language sql
security definer
set search_path = ''
as $$
  with mapped as (
    select case p_kind
      when 'invite' then 'invite'::public.push_kind
      when 'update' then 'update'::public.push_kind
      when 'cancel' then 'cancel'::public.push_kind
      when 'reminder' then 'reminder'::public.push_kind
    end as kind
  )
  insert into public.push_deliveries (subscription_id, invitee_id, kind, audience, job_id)
  select s.id, p_invitee, k.kind,
    case when k.kind = 'reminder' then coalesce(p_audience, 'pending') end, p_job
  from mapped k
  join public.meeting_invitees i on i.id = p_invitee
  join public.contacts c on c.id = i.contact_id
  join auth.users u on u.email = c.email and u.is_sso_user = false and u.email_confirmed_at is not null
  join public.push_subscriptions s on s.user_id = u.id
  where k.kind is not null and c.unsubscribed_at is null
  on conflict (job_id, subscription_id) do nothing
$$;

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
  -- An email that went out brings its phone notifications (spec §8 Push worker: no email, no push);
  -- push_enqueue decides which kinds have one.
  if p_outcome = 'sent' then
    perform private.push_enqueue(p_job, v_invitee, v_kind, v_payload ->> 'audience');
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

-- Delete my account, the database part (spec §11). The route then revokes the released tokens,
-- emails the alerts and deletes the auth user through the admin API (cascading to the profile and
-- push subscriptions). Calling it again after a failed admin call is harmless.
-- Each affected workspace's Owner gets one email (spec §11): kind sender, sheet, or both. The
-- sheet part follows the once-a-day sheet alert (private.sheet_alert_target); when that already
-- went out today, a stopped sender is still told on its own.
create or replace function private.delete_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_connections uuid[];
  v_senders uuid[];
  v_sheets uuid[];
  v_workspace uuid;
  v_alerts jsonb := '[]'::jsonb;
  v_target jsonb;
  v_kind text;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if p_confirm is distinct from 'confirm' then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('account_delete') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  -- Lock the person's seats first: an ownership transfer to them (which needs an existing Admin
  -- seat) waits, then finds no seat.
  perform 1 from public.workspace_roles r where r.user_id = v_user for update;
  if exists (select 1 from public.workspace_roles r where r.user_id = v_user and r.role = 'owner') then
    raise exception 'tn:owns_workspaces' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles r where r.user_id = v_user;

  -- Reasons and comments go everywhere; statuses and check-ins stay for the groups (the sheet
  -- triggers mark the years, so the Google Sheet drops the words at its next redraw).
  update public.responses r set reason = '', comment = ''
  where r.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (r.reason <> '' or r.comment <> '');
  update public.response_history h set reason = '', comment = ''
  where h.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (h.reason <> '' or h.comment <> '');

  select coalesce(pg_catalog.array_agg(c.id), '{}') into v_connections
  from public.google_connections c where c.user_id = v_user;

  with stopped as (
    update public.workspaces w set sender_connection_id = null
    where w.sender_connection_id = any (v_connections)
    returning w.id
  )
  select coalesce(pg_catalog.array_agg(s.id), '{}') into v_senders from stopped s;

  -- The sheet keeps its account (google_sub/email) for "Pick that account"; only the link goes.
  with paused as (
    update public.sheet_syncs s
    set status = 'paused', paused_reason = 'access_lost', paused_at = pg_catalog.now(),
      run_id = null, locked_until = null, connection_id = null
    where s.connection_id = any (v_connections)
    returning s.workspace_id
  )
  select coalesce(pg_catalog.array_agg(p.workspace_id), '{}') into v_sheets from paused p;

  for v_workspace in
    select distinct x.id from pg_catalog.unnest(v_senders || v_sheets) as x(id)
  loop
    v_target := null;
    if v_workspace = any (v_sheets) then
      v_target := private.sheet_alert_target(v_workspace);
      v_kind := case when v_workspace = any (v_senders) then 'both' else 'sheet' end;
    end if;
    if v_target is null and v_workspace = any (v_senders) then
      v_target := private.owner_alert_target(v_workspace);
      v_kind := 'sender';
    end if;
    if v_target is not null then
      v_alerts := v_alerts || pg_catalog.jsonb_build_array(v_target || pg_catalog.jsonb_build_object('kind', v_kind));
    end if;
  end loop;

  -- Nothing uses them now; release_connection keeps the token when another person's connection
  -- holds the same Google account (spec §9, M7 final review).
  return pg_catalog.jsonb_build_object(
    'released', coalesce((
      select pg_catalog.jsonb_agg(x.released)
      from (select private.release_connection(c, v_user) as released from pg_catalog.unnest(v_connections) as c) x
      where x.released is not null), '[]'::jsonb),
    'alerts', v_alerts
  );
end;
$$;
