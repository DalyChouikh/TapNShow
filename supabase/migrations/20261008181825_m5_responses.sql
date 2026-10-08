-- M5 responses (spec §4, §6, §7.3, §8): members answer only through their personal link; the
-- token routes call these service-role functions, which validate the answer against the meeting,
-- write the answer and its history row, and refresh the person's calendar job in one transaction.

insert into private.app_limits (name, value) values ('calendar_confirm_delay_seconds', 60);

create type public.response_status as enum ('attending', 'late', 'absent', 'not_attending');
create type public.calendar_state as enum ('none', 'added');

alter table public.meeting_invitees
  add column calendar_state public.calendar_state not null default 'none',
  add column calendar_sequence integer not null default 0 check (calendar_sequence >= 0),
  add column calendar_requested_at timestamptz;

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meeting_id uuid not null,
  invitee_id uuid not null unique references public.meeting_invitees (id) on delete cascade,
  status public.response_status not null,
  delay_minutes smallint check (delay_minutes between 1 and 240),
  reason text not null default '' check (reason = btrim(reason) and char_length(reason) <= 500),
  comment text not null default '' check (comment = btrim(comment) and char_length(comment) <= 500),
  after_deadline boolean not null default false,
  needs_reconfirmation boolean not null default false,
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'late') = (delay_minutes is not null)),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);
create index responses_meeting_ws_idx on public.responses (meeting_id, workspace_id);
create index responses_workspace_idx on public.responses (workspace_id);

create table public.response_history (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  invitee_id uuid not null references public.meeting_invitees (id) on delete cascade,
  response_id uuid not null references public.responses (id) on delete cascade,
  status public.response_status not null,
  delay_minutes smallint,
  reason text not null default '',
  comment text not null default '',
  after_deadline boolean not null,
  changed_at timestamptz not null default now()
);
create index response_history_invitee_idx on public.response_history (invitee_id, changed_at);
create index response_history_response_idx on public.response_history (response_id);
create index response_history_meeting_idx on public.response_history (meeting_id);
create index response_history_workspace_idx on public.response_history (workspace_id);

alter table public.responses enable row level security;
alter table public.response_history enable row level security;
revoke all on table public.responses, public.response_history from anon, authenticated;
grant select on table public.responses, public.response_history to authenticated;
grant all on table public.responses, public.response_history to service_role;
create policy responses_select_members on public.responses
  for select to authenticated using (private.is_member(workspace_id));
create policy response_history_select_members on public.response_history
  for select to authenticated using (private.is_member(workspace_id));

-- One pending (or paused) calendar job per person, pushed back on every save (spec §8). The caller
-- holds the invitee row lock, so two saves for one person never both insert.
create function private.refresh_calendar_job(p_invitee uuid, p_workspace uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_due timestamptz := pg_catalog.now()
    + pg_catalog.make_interval(secs => private.app_limit('calendar_confirm_delay_seconds'));
begin
  update public.outbox_jobs
  set run_after = v_due, last_error = null
  where invitee_id = p_invitee and kind = 'calendar_confirm' and status in ('pending', 'paused');
  if not found then
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, idempotency_key, run_after)
    values ('calendar_confirm', p_workspace, p_invitee,
      'calendar:' || p_invitee::text || ':' || gen_random_uuid()::text, v_due);
  end if;
end;
$$;
revoke execute on function private.refresh_calendar_job(uuid, uuid) from public, anon, authenticated;
grant execute on function private.refresh_calendar_job(uuid, uuid) to service_role;

create function public.token_submit_response(
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
    v_new := v_old;
  else
    insert into public.responses (workspace_id, meeting_id, invitee_id, status, delay_minutes, reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, p_status, v_delay, v_reason, v_comment, v_after)
    on conflict (invitee_id) do update
      set status = excluded.status, delay_minutes = excluded.delay_minutes, reason = excluded.reason,
        comment = excluded.comment, after_deadline = excluded.after_deadline, updated_at = pg_catalog.now()
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
    'responded_at', v_new.responded_at, 'updated_at', v_new.updated_at
  );
end;
$$;
revoke execute on function public.token_submit_response(text, public.response_status, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.token_submit_response(text, public.response_status, integer, text, text)
  to service_role;

create function public.token_request_calendar(p_token_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v record;
begin
  select i.id as invitee_id, i.workspace_id, i.calendar_requested_at, m.status, m.starts_at, m.response_mode
  into v
  from public.meeting_invitees i
  join public.meetings m on m.id = i.meeting_id
  where i.token_hash = p_token_hash
  for update of i;
  if v.invitee_id is null then
    return false;
  end if;
  if v.response_mode <> 'announcement' then
    raise exception 'tn:invalid_choice' using errcode = 'P0001';
  end if;
  if v.status <> 'scheduled' or v.starts_at is null or v.starts_at <= pg_catalog.now() then
    raise exception 'tn:answers_closed' using errcode = 'P0001';
  end if;
  if v.calendar_requested_at is null then
    update public.meeting_invitees set calendar_requested_at = pg_catalog.now() where id = v.invitee_id;
    perform private.refresh_calendar_job(v.invitee_id, v.workspace_id);
  end if;
  return true;
end;
$$;
revoke execute on function public.token_request_calendar(text) from public, anon, authenticated;
grant execute on function public.token_request_calendar(text) to service_role;

-- token_invitee: latest body from 20261008152332_m4_online_place.sql plus the answer page's fields.
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
      'status', m.status
    ),
    'answers', pg_catalog.jsonb_build_object(
      'response_mode', m.response_mode, 'delay_options', m.delay_options, 'reason_required', m.reason_required,
      'comments_enabled', m.comments_enabled, 'footer_note', m.footer_note, 'response_deadline', m.response_deadline
    ),
    'answer', case when r.id is null then null else pg_catalog.jsonb_build_object(
      'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
      'after_deadline', r.after_deadline, 'responded_at', r.responded_at, 'updated_at', r.updated_at
    ) end
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.responses r on r.invitee_id = i.id
  where i.token_hash = p_token_hash;
$$;
