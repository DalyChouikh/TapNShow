-- M3 roster (spec §6 People & lists, §11): contacts, lists, memberships, caps, roster reads.

insert into private.app_limits (name, value) values
  ('contacts_per_workspace_max', 2000),
  ('lists_per_workspace_max', 50),
  ('import_rows_max', 2000),
  ('imports_per_user_per_hour', 30),
  ('import_previews_per_user_per_hour', 120);

-- Same rule as the app's emailSchema (Zod 4.6 `z.email()` on the lower-cased address).
create function private.is_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
    and char_length(p_email) <= 254
    and p_email ~ '^([A-Za-z0-9_''+-]+\.)*[A-Za-z0-9_''+-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$';
$$;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and private.is_valid_email(email)),
  full_name text not null check (full_name = btrim(full_name) and char_length(full_name) between 1 and 120),
  user_id uuid references auth.users (id) on delete set null,
  unsubscribed_at timestamptz,
  is_adhoc boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (id, workspace_id)
);
create index contacts_user_id_idx on public.contacts (user_id);
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function private.set_updated_at();

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create unique index lists_workspace_name_key on public.lists (workspace_id, lower(name));
create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function private.set_updated_at();

-- workspace_id + composite keys: a membership can only join a list and a contact of the same workspace.
create table public.list_contacts (
  workspace_id uuid not null,
  list_id uuid not null,
  contact_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (list_id, contact_id),
  foreign key (list_id, workspace_id) references public.lists (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index list_contacts_list_ws_idx on public.list_contacts (list_id, workspace_id);
create index list_contacts_contact_ws_idx on public.list_contacts (contact_id, workspace_id);

-- Caps (spec §6): checked after each insert statement, under a per-workspace advisory lock, so two
-- concurrent imports cannot both pass. Read Committed gives each query here a fresh snapshot, so
-- the second transaction to take the lock counts the first one's committed rows.
create function private.enforce_roster_caps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_count integer;
begin
  for v_workspace in select distinct n.workspace_id from new_rows n loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('roster:' || tg_table_name || ':' || v_workspace::text));
    if tg_table_name = 'contacts' then
      select count(*) into v_count from public.contacts c where c.workspace_id = v_workspace and not c.is_adhoc;
      if v_count > private.app_limit('contacts_per_workspace_max') then
        raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
      end if;
    else
      select count(*) into v_count from public.lists l where l.workspace_id = v_workspace;
      if v_count > private.app_limit('lists_per_workspace_max') then
        raise exception 'tn:lists_limit_reached' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  return null;
end;
$$;
create trigger contacts_enforce_cap
  after insert on public.contacts
  referencing new table as new_rows
  for each statement execute function private.enforce_roster_caps();
create trigger lists_enforce_cap
  after insert on public.lists
  referencing new table as new_rows
  for each statement execute function private.enforce_roster_caps();

create function private.hit_user_rate_limit(p_action text)
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
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.app_limit(text),
  private.is_valid_email(text),
  private.hit_user_rate_limit(text)
to authenticated;
-- The email check constraint and the cap triggers run as the inserting role, which is
-- service_role for server-side writes (dispatcher, token route, test setup).
grant execute on function private.app_limit(text), private.is_valid_email(text) to service_role;

-- Grants + RLS (new tables are not exposed by default).
alter table public.contacts enable row level security;
alter table public.lists enable row level security;
alter table public.list_contacts enable row level security;
revoke all on table public.contacts, public.lists, public.list_contacts from anon, authenticated;
grant select on table public.contacts, public.lists, public.list_contacts to authenticated;
grant insert (workspace_id, email, full_name), update (email, full_name), delete on table public.contacts to authenticated;
grant insert (workspace_id, name), update (name), delete on table public.lists to authenticated;
grant insert (workspace_id, list_id, contact_id), delete on table public.list_contacts to authenticated;
grant all on table public.contacts, public.lists, public.list_contacts to service_role;

create policy contacts_select_members on public.contacts
  for select to authenticated using (private.is_member(workspace_id));
create policy contacts_insert_managers on public.contacts
  for insert to authenticated with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy contacts_update_managers on public.contacts
  for update to authenticated
  using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy contacts_delete_managers on public.contacts
  for delete to authenticated using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy lists_select_members on public.lists
  for select to authenticated using (private.is_member(workspace_id));
create policy lists_insert_managers on public.lists
  for insert to authenticated with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy lists_update_managers on public.lists
  for update to authenticated
  using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy lists_delete_managers on public.lists
  for delete to authenticated using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy list_contacts_select_members on public.list_contacts
  for select to authenticated using (private.is_member(workspace_id));
create policy list_contacts_insert_managers on public.list_contacts
  for insert to authenticated with check (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy list_contacts_delete_managers on public.list_contacts
  for delete to authenticated using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- The whole roster as one value: a table select would stop at the Data API's 1,000-row cap.
create function public.roster(p_workspace uuid)
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
          ), '[]'::jsonb)
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

create function public.set_contact_lists(p_contact uuid, p_list_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select c.workspace_id into v_workspace from public.contacts c where c.id = p_contact;
  if v_workspace is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(coalesce(p_list_ids, '{}')) as x(id)
    where not exists (select 1 from public.lists l where l.id = x.id and l.workspace_id = v_workspace)
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  delete from public.list_contacts lc
  where lc.contact_id = p_contact and lc.list_id <> all (coalesce(p_list_ids, '{}'));
  insert into public.list_contacts (workspace_id, list_id, contact_id)
  select v_workspace, x.id, p_contact from pg_catalog.unnest(coalesce(p_list_ids, '{}')) as x(id)
  on conflict do nothing;
end;
$$;

create function public.bulk_contacts(p_workspace uuid, p_action text, p_contact_ids uuid[], p_list_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_action in ('add_to_list', 'remove_from_list') and not exists (
    select 1 from public.lists l where l.id = p_list_id and l.workspace_id = p_workspace
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  case p_action
    when 'delete' then
      delete from public.contacts c where c.workspace_id = p_workspace and c.id = any (p_contact_ids);
    when 'add_to_list' then
      insert into public.list_contacts (workspace_id, list_id, contact_id)
      select p_workspace, p_list_id, c.id from public.contacts c
      where c.workspace_id = p_workspace and c.id = any (p_contact_ids)
      on conflict do nothing;
    when 'remove_from_list' then
      delete from public.list_contacts lc
      where lc.workspace_id = p_workspace and lc.list_id = p_list_id and lc.contact_id = any (p_contact_ids);
    else
      raise exception 'tn:invalid_input' using errcode = 'P0001';
  end case;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  public.roster(uuid),
  public.set_contact_lists(uuid, uuid[]),
  public.bulk_contacts(uuid, text, uuid[], uuid)
from public, anon;
grant execute on function
  public.roster(uuid),
  public.set_contact_lists(uuid, uuid[]),
  public.bulk_contacts(uuid, text, uuid[], uuid)
to authenticated;
