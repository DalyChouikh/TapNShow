-- M8 phone notifications (spec §6 push_subscriptions / push_deliveries, §8 Push worker, §11).
-- Latest bodies: dispatch_finish from 20261011124719_m7_minors_edits.sql, workers_due from
-- 20261011183115_m7_followups.sql, housekeeping from 20261011094523_m7_sheet_worker.sql.
-- push_deliveries_run_after_idx is a plain index: an expired lease must be found again, and
-- "expired" depends on now(), which no partial index predicate can name.

insert into private.app_limits (name, value) values
  ('push_devices_per_user_max', 10),
  ('push_attempts_max', 5),
  ('push_retry_max_minutes', 30),
  ('push_subscription_idle_days', 90);

create type public.push_kind as enum ('invite', 'update', 'cancel', 'reminder');

-- One row per browser. Key shapes twin pushSubscriptionBodySchema (src/shared/api/push.ts):
-- p256dh is a 65-byte P-256 point and auth 16 bytes, base64url.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{21,24}={0,2}$'),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at);

-- The push queue: only pending work (rows go when sent or given up).
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  invitee_id uuid not null references public.meeting_invitees (id) on delete cascade,
  kind public.push_kind not null,
  audience text check (audience in ('pending', 'going') and kind = 'reminder' or audience is null and kind <> 'reminder'),
  job_id uuid not null,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz,
  run_id uuid,
  created_at timestamptz not null default now(),
  unique (job_id, subscription_id)
);
create index push_deliveries_run_after_idx on public.push_deliveries (run_after);
create index push_deliveries_subscription_idx on public.push_deliveries (subscription_id);
create index push_deliveries_invitee_idx on public.push_deliveries (invitee_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on table public.push_subscriptions, public.push_deliveries from anon, authenticated;
grant all on table public.push_subscriptions, public.push_deliveries to service_role;

-- The browsers' push services (spec §11 Push privacy): the only hosts the server will ever send a
-- push to, so a made-up endpoint can't turn the push lane into a way to call other sites. Hosts
-- from the vendors' documentation (FCM for Chrome, Edge and Android, legacy GCM, Mozilla autopush,
-- Apple "any subdomain of push.apple.com", Windows notification services). A row, not code, so a
-- new browser's service can be added without a release; e2e adds its local fake here.
create table private.push_service_hosts (
  host text primary key check (host = lower(host) and host !~ '[/@?#\s]'),
  include_subdomains boolean not null
);
insert into private.push_service_hosts (host, include_subdomains) values
  ('fcm.googleapis.com', false),
  ('android.googleapis.com', false),
  ('updates.push.services.mozilla.com', false),
  ('push.apple.com', true),
  ('notify.windows.com', true);

-- Whether an endpoint is https on a listed push service. The authority must be a listed host (or a
-- subdomain where allowed), with no user info; a port is accepted only when a row names it
-- (local fakes). Matching is exact, so "fcm.googleapis.com.evil.example" never passes.
create function private.push_endpoint_allowed(p_endpoint text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with authority as (
    select pg_catalog.lower(pg_catalog.substring(p_endpoint, '^https://([^/?#]+)(?:[/?#]|$)')) as value
  )
  select exists (
    select 1 from authority a, private.push_service_hosts h
    where a.value is not null and pg_catalog.strpos(a.value, '@') = 0
      and (a.value = h.host
        or (h.include_subdomains and a.value !~ ':' and pg_catalog.right(a.value, pg_catalog.length(h.host) + 1) = '.' || h.host))
  )
$$;
revoke execute on function private.push_endpoint_allowed(text) from public, anon, authenticated;

-- Turn on reminders for this browser (spec §7.4). An endpoint already held by another account
-- moves to the caller (a shared phone), and that account's pending pushes for it go.
create function private.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('push_subscribe') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  if not private.push_endpoint_allowed(p_endpoint) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  delete from public.push_deliveries d using public.push_subscriptions s
  where d.subscription_id = s.id and s.endpoint = p_endpoint and s.user_id <> v_user;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth)
  values (v_user, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
  set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    created_at = case when s.user_id = excluded.user_id then s.created_at else pg_catalog.now() end,
    last_success_at = case when s.user_id = excluded.user_id then s.last_success_at end;
  delete from public.push_subscriptions s
  where s.id in (
    select x.id from public.push_subscriptions x
    where x.user_id = v_user
    order by x.created_at desc, x.id desc
    offset private.app_limit('push_devices_per_user_max'));
end;
$$;

-- Turn off reminders for this browser: only the caller's own row.
create function private.push_unsubscribe(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid()
$$;

-- A sent email's notifications: one row per device of the person the invite matches. The contact
-- → account direction of the matching rule; twin: private.contacts_of (account → contacts).
-- Unsubscribed people get none (cancellations still email some of them, spec §7.16 / #254).
create function private.push_enqueue(p_job uuid, p_invitee uuid, p_kind public.job_kind, p_audience text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_deliveries (subscription_id, invitee_id, kind, audience, job_id)
  select s.id, p_invitee, p_kind::text::public.push_kind,
    case when p_kind = 'reminder' then coalesce(p_audience, 'pending') end, p_job
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id and c.workspace_id = i.workspace_id
  join auth.users u on u.email = c.email and u.is_sso_user = false and u.email_confirmed_at is not null
  join public.push_subscriptions s on s.user_id = u.id
  where i.id = p_invitee and c.unsubscribed_at is null
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
  -- An email that went out brings its phone notifications (spec §8 Push worker: no email, no push).
  if p_outcome = 'sent' and v_kind <> 'calendar_confirm' then
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

-- Lease due deliveries for one run (spec §8). Stale ones are deleted first, in SQL: the meeting was
-- cancelled or has started (a cancellation still goes), a reminder whose person no longer fits it
-- (the reminders' own rule, private.reminder_eligible), or the attempts are spent. "Due" (run_after
-- reached, no live lease) is the same predicate as private.workers_due.
create function private.push_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_max_attempts integer := private.app_limit('push_attempts_max');
  v_dropped integer;
  v_result jsonb;
begin
  with stale as (
    delete from public.push_deliveries d
    using public.meeting_invitees i
    join public.meetings m on m.id = i.meeting_id
    left join public.responses r on r.invitee_id = i.id
    where d.invitee_id = i.id
      and d.run_after <= v_now and (d.locked_until is null or d.locked_until < v_now)
      and (
        -- Runs that crashed or timed out never reported back: their leases expired with the
        -- attempt counted, so a delivery that keeps failing that way stops here.
        d.attempts >= v_max_attempts
        or (d.kind <> 'cancel'
          and (m.status <> 'scheduled' or m.starts_at <= v_now
            or (d.kind = 'reminder' and not private.reminder_eligible(d.audience, r.status, r.needs_reconfirmation)))))
    returning 1
  )
  select count(*) into v_dropped from stale;
  with picked as (
    select d.id from public.push_deliveries d
    where d.run_after <= v_now and (d.locked_until is null or d.locked_until < v_now)
    order by d.run_after
    limit p_limit
    for update skip locked
  ), leased as (
    update public.push_deliveries d
    set locked_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds), run_id = p_run,
      attempts = d.attempts + 1
    from picked where d.id = picked.id
    returning d.id, d.kind, d.audience, d.attempts, d.invitee_id, d.subscription_id
  )
  select pg_catalog.jsonb_build_object('dropped', v_dropped, 'items', coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', l.id, 'kind', l.kind, 'audience', l.audience, 'attempts', l.attempts, 'invitee_id', l.invitee_id,
      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
      'workspace_name', w.name, 'locale', w.locale,
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone,
      'duration_minutes', m.duration_minutes, 'location_mode', m.location_mode,
      'location_text', m.location_text, 'online_text', m.online_text, 'response_mode', m.response_mode,
      'answered', r.id is not null, 'needs_reconfirmation', coalesce(r.needs_reconfirmation, false))),
    '[]'::jsonb))
  from leased l
  join public.push_subscriptions s on s.id = l.subscription_id
  join public.meeting_invitees i on i.id = l.invitee_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = m.workspace_id
  left join public.responses r on r.invitee_id = i.id
  into v_result;
  return v_result;
end;
$$;

-- Sent: the row goes and the device is marked as reachable.
create function private.push_done(p_delivery uuid, p_run uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription uuid;
begin
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
  returning d.subscription_id into v_subscription;
  if v_subscription is null then
    return false;
  end if;
  update public.push_subscriptions set last_success_at = pg_catalog.now() where id = v_subscription;
  return true;
end;
$$;

-- Try again later (capped at push_retry_max_minutes), or give up after push_attempts_max. False
-- when given up or when this run no longer holds the lease.
create function private.push_retry(p_delivery uuid, p_run uuid, p_after_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select d.attempts into v_attempts from public.push_deliveries d
  where d.id = p_delivery and d.run_id = p_run for update;
  if v_attempts is null then
    return false;
  end if;
  if v_attempts >= private.app_limit('push_attempts_max') then
    delete from public.push_deliveries where id = p_delivery;
    return false;
  end if;
  update public.push_deliveries
  set run_after = pg_catalog.now() + pg_catalog.make_interval(secs =>
        least(greatest(p_after_seconds, 1), private.app_limit('push_retry_max_minutes') * 60)),
    locked_until = null, run_id = null
  where id = p_delivery;
  return true;
end;
$$;

-- A delivery that can never succeed (a bug on our side, 400/413): dropped.
create function private.push_drop(p_delivery uuid, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
$$;

-- The push service says the device is gone (404/410): the subscription goes, with its deliveries.
create function private.push_gone(p_delivery uuid, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
  using public.push_deliveries d
  where d.id = p_delivery and d.run_id = p_run and s.id = d.subscription_id
$$;

create or replace function private.workers_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.outbox_jobs j
      where (j.status = 'pending' and j.run_after <= pg_catalog.now() and not private.job_held(j.kind, j.invitee_id))
        or (j.status = 'processing' and j.locked_until < pg_catalog.now()))
    or exists (
      select 1 from public.sheet_syncs s
      where s.status = 'active' and s.retry_at <= pg_catalog.now() and private.sheet_due(s))
    -- A push delivery is due: the same "due" predicate as private.push_claim.
    or exists (
      select 1 from public.push_deliveries d
      where d.run_after <= pg_catalog.now() and (d.locked_until is null or d.locked_until < pg_catalog.now()))
$$;

create or replace function private.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.rate_limit_events e where e.occurred_at < pg_catalog.now() - interval '2 days';
  delete from public.outbox_jobs j where j.status in ('done', 'failed') and j.updated_at < pg_catalog.now() - interval '30 days';
  delete from public.send_log s where s.sent_at < pg_catalog.now() - interval '30 days';
  delete from public.sender_leases l where l.locked_until < pg_catalog.now() - interval '1 day';
  -- "+" creates a draft at once (grilling 2026-10-07); one left untitled and undated is litter.
  delete from public.meetings m
  where m.status = 'draft' and m.title = '' and m.starts_at is null and m.created_at < pg_catalog.now() - interval '24 hours';
  -- The current year of every sheet is redrawn once a day, so edits made in the sheet are repaired.
  perform private.sheet_mark(pg_catalog.array_agg(s.workspace_id), pg_catalog.array_agg(private.sheet_year(pg_catalog.now(), w.timezone)))
  from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
  where s.spreadsheet_id is not null;
  -- Devices that never or no longer receive notifications, and pushes nobody will send any more.
  delete from public.push_subscriptions s
  where coalesce(s.last_success_at, s.created_at)
    < pg_catalog.now() - pg_catalog.make_interval(days => private.app_limit('push_subscription_idle_days'));
  delete from public.push_deliveries d where d.created_at < pg_catalog.now() - interval '1 day';
end;
$$;

create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security invoker set search_path = ''
as $$ select private.push_subscribe(p_endpoint, p_p256dh, p_auth) $$;
create function public.push_unsubscribe(p_endpoint text)
returns void language sql security invoker set search_path = ''
as $$ select private.push_unsubscribe(p_endpoint) $$;
create function public.push_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.push_claim(p_run, p_limit, p_lease_seconds) $$;
create function public.push_done(p_delivery uuid, p_run uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.push_done(p_delivery, p_run) $$;
create function public.push_retry(p_delivery uuid, p_run uuid, p_after_seconds integer)
returns boolean language sql security invoker set search_path = ''
as $$ select private.push_retry(p_delivery, p_run, p_after_seconds) $$;
create function public.push_drop(p_delivery uuid, p_run uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.push_drop(p_delivery, p_run) $$;
create function public.push_gone(p_delivery uuid, p_run uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.push_gone(p_delivery, p_run) $$;

revoke execute on function private.push_enqueue(uuid, uuid, public.job_kind, text) from public, anon, authenticated;
-- dispatch_finish (invoker) runs as the service role and calls it.
grant execute on function private.push_enqueue(uuid, uuid, public.job_kind, text) to service_role;

grant execute on function private.push_subscribe(text, text, text), private.push_unsubscribe(text) to authenticated;
revoke execute on function private.push_subscribe(text, text, text), private.push_unsubscribe(text) from public, anon;
revoke execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text) to authenticated;

revoke execute on function
  private.push_claim(uuid, integer, integer), private.push_done(uuid, uuid),
  private.push_retry(uuid, uuid, integer), private.push_drop(uuid, uuid), private.push_gone(uuid, uuid),
  public.push_claim(uuid, integer, integer), public.push_done(uuid, uuid),
  public.push_retry(uuid, uuid, integer), public.push_drop(uuid, uuid), public.push_gone(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  private.push_claim(uuid, integer, integer), private.push_done(uuid, uuid),
  private.push_retry(uuid, uuid, integer), private.push_drop(uuid, uuid), private.push_gone(uuid, uuid),
  public.push_claim(uuid, integer, integer), public.push_done(uuid, uuid),
  public.push_retry(uuid, uuid, integer), public.push_drop(uuid, uuid), public.push_gone(uuid, uuid)
to service_role;
