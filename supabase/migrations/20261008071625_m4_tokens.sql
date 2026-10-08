-- M4 public token pages (spec §7.16, §11 public token route): unsubscribe, "Not my group", lookup.

insert into private.app_limits (name, value) values
  ('token_requests_per_ip_per_hour', 120),
  ('token_requests_per_token_per_hour', 30);

create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invitee_id uuid not null unique references public.meeting_invitees (id) on delete cascade,
  reported_at timestamptz not null default now()
);
create index abuse_reports_workspace_idx on public.abuse_reports (workspace_id, reported_at);
alter table public.abuse_reports enable row level security;
revoke all on table public.abuse_reports from anon, authenticated;
grant all on table public.abuse_reports to service_role;

create function public.token_invitee(p_token_hash text)
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
    'unsubscribed', c.unsubscribed_at is not null,
    'reported', c.unsubscribed_via is not distinct from 'report',
    'meeting', pg_catalog.jsonb_build_object(
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone, 'duration_minutes', m.duration_minutes,
      'location_mode', m.location_mode, 'location_text', m.location_text, 'meeting_url', m.meeting_url,
      'status', m.status
    )
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash;
$$;

create function public.token_unsubscribe(p_token_hash text, p_via public.unsubscribe_via)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitee uuid;
  v_workspace uuid;
begin
  update public.contacts c
  set unsubscribed_at = coalesce(c.unsubscribed_at, pg_catalog.now()),
    unsubscribed_via = case when p_via = 'report' then 'report'::public.unsubscribe_via
                            else coalesce(c.unsubscribed_via, 'link'::public.unsubscribe_via) end
  from public.meeting_invitees i
  where i.token_hash = p_token_hash and c.id = i.contact_id
  returning i.id, i.workspace_id into v_invitee, v_workspace;
  if v_invitee is null then
    return false;
  end if;
  if p_via = 'report' then
    insert into public.abuse_reports (workspace_id, invitee_id) values (v_workspace, v_invitee)
    on conflict (invitee_id) do nothing;
  end if;
  return true;
end;
$$;

create function public.token_resubscribe(p_token_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  update public.contacts c
  set unsubscribed_at = null, unsubscribed_via = null
  from public.meeting_invitees i
  where i.token_hash = p_token_hash and c.id = i.contact_id
  returning c.id into v_contact;
  return v_contact is not null;
end;
$$;

create function private.check_token_rate_limit(p_ip text, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_ip, '')) not between 1 and 64 or char_length(coalesce(p_token_hash, '')) not between 1 and 128 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit('token:ip:' || p_ip, private.app_limit('token_requests_per_ip_per_hour'), interval '1 hour')
    and private.hit_rate_limit('token:hash:' || p_token_hash, private.app_limit('token_requests_per_token_per_hour'), interval '1 hour');
end;
$$;

create function public.check_token_rate_limit(p_ip text, p_token_hash text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.check_token_rate_limit(p_ip, p_token_hash) $$;

-- roster(): contacts carry the unsubscribe and report flags (Task 17 shows them).
create or replace function public.roster(p_workspace uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'contacts', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', c.id,
          'email', c.email,
          'full_name', c.full_name,
          'list_ids', coalesce((
            select pg_catalog.jsonb_agg(lc.list_id order by lc.list_id)
            from public.list_contacts lc where lc.contact_id = c.id
          ), '[]'::jsonb),
          'unsubscribed', c.unsubscribed_at is not null,
          'reported', c.unsubscribed_via is not distinct from 'report'
        )
        order by lower(c.full_name), c.email
      )
      from public.contacts c
      where c.workspace_id = p_workspace and not c.is_adhoc
    ), '[]'::jsonb),
    'lists', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', l.id,
          'name', l.name,
          'contact_count', (
            select count(*) from public.list_contacts lc
            join public.contacts c on c.id = lc.contact_id
            where lc.list_id = l.id and not c.is_adhoc
          )
        )
        order by lower(l.name)
      )
      from public.lists l
      where l.workspace_id = p_workspace
    ), '[]'::jsonb),
    'limits', pg_catalog.jsonb_build_object(
      'contacts_max', private.app_limit('contacts_per_workspace_max'),
      'lists_max', private.app_limit('lists_per_workspace_max'),
      'import_rows_max', private.app_limit('import_rows_max')
    )
  );
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function private.check_token_rate_limit(text, text) from authenticated;
grant execute on function private.check_token_rate_limit(text, text), private.mask_email(text) to service_role;

revoke execute on function
  public.token_invitee(text),
  public.token_unsubscribe(text, public.unsubscribe_via),
  public.token_resubscribe(text),
  public.check_token_rate_limit(text, text)
from public, anon, authenticated;
grant execute on function
  public.token_invitee(text),
  public.token_unsubscribe(text, public.unsubscribe_via),
  public.token_resubscribe(text),
  public.check_token_rate_limit(text, text)
to service_role;
