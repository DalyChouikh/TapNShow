-- M8 final review fixes (spec §8 Push worker, §11 Push privacy).
-- Latest bodies: push_subscribe, push_claim and housekeeping from 20261014160152_m8_push.sql.
--
-- 1. A device is alive while it checks in (the app re-sends its subscription, at most once a day)
--    or receives notifications. Before, only received notifications counted, so a member whose
--    groups were quiet for push_subscription_idle_days lost reminders while the app still said
--    they were on. last_active_at is the one "last sign of life" rule: eviction and housekeeping
--    both read it.
-- 2. push_claim also drops an invite already answered (it would still ask "Are you coming?") and
--    anything for a person who unsubscribed after it was queued (unsubscribe stops everything).

alter table public.push_subscriptions
  add column last_seen_at timestamptz not null default now(),
  add column last_active_at timestamptz generated always as (greatest(last_seen_at, last_success_at)) stored;

-- Per person there are at most push_devices_per_user_max rows: user_id alone finds them (the
-- foreign key's cascade needs it too); created_at no longer orders anything.
drop index public.push_subscriptions_user_idx;
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Turn on reminders for this browser, or check in again (spec §7.4). An endpoint already held by
-- another account moves to the caller (a shared phone), and that account's pending pushes for it
-- go. Over the device limit, the device seen least recently goes.
create or replace function private.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
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
    last_success_at = case when s.user_id = excluded.user_id then s.last_success_at end,
    last_seen_at = pg_catalog.now();
  delete from public.push_subscriptions s
  where s.id in (
    select x.id from public.push_subscriptions x
    where x.user_id = v_user
    order by x.last_active_at desc, x.id desc
    offset private.app_limit('push_devices_per_user_max'));
end;
$$;

-- Lease due deliveries for one run (spec §8). Stale ones are deleted first, in SQL: the person
-- unsubscribed since it was queued; the meeting was cancelled or has started (a cancellation still
-- goes); an invite already answered; a reminder whose person no longer fits it (the reminders' own
-- rule, private.reminder_eligible); or the attempts are spent. "Due" (run_after reached, no live
-- lease) is the same predicate as private.workers_due.
create or replace function private.push_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
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
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where d.invitee_id = i.id
      and d.run_after <= v_now and (d.locked_until is null or d.locked_until < v_now)
      and (
        -- Runs that crashed or timed out never reported back: their leases expired with the
        -- attempt counted, so a delivery that keeps failing that way stops here.
        d.attempts >= v_max_attempts
        -- Unsubscribe stops everything, cancellations included (twin: private.push_enqueue).
        or c.unsubscribed_at is not null
        or (d.kind <> 'cancel'
          and (m.status <> 'scheduled' or m.starts_at <= v_now
            or (d.kind = 'invite' and r.id is not null)
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
  -- Devices with no sign of life (no check-in, no notification received), and pushes nobody will
  -- send any more.
  delete from public.push_subscriptions s
  where s.last_active_at
    < pg_catalog.now() - pg_catalog.make_interval(days => private.app_limit('push_subscription_idle_days'));
  delete from public.push_deliveries d where d.created_at < pg_catalog.now() - interval '1 day';
end;
$$;
