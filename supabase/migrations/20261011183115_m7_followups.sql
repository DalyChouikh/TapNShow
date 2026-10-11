-- M7 follow-ups (#291, final review minors).
-- Latest bodies: retry_sheet from 20261011091257_m7_sheet_state.sql.

-- The Google Drive holding the sheet is full (Drive `storageQuotaExceeded`): Google refuses new
-- files and edits until space is freed, so the sheet pauses and Try again resumes it (Owner,
-- 2026-10-11). Twin: sheetPauseReasonSchema.
alter type public.sheet_pause_reason add value 'drive_full';

-- retry_sheet: Try again also resumes a sheet paused because its Drive was full. Twin:
-- SHEET_RETRYABLE_REASONS (src/shared/api/sheets.ts).
create or replace function private.retry_sheet(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
begin
  perform private.require_owner(p_workspace);
  select * into v_sheet from public.sheet_syncs where workspace_id = p_workspace for update;
  if v_sheet.workspace_id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_sheet.status = 'paused' and v_sheet.paused_reason not in ('trashed', 'drive_full') then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('sheet_retry') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  update public.sheet_syncs
  set status = 'active', paused_reason = null, paused_at = null, retry_at = pg_catalog.now(), attempts = 0
  where workspace_id = p_workspace;
  perform private.sheet_mark(array[p_workspace],
    array[(select private.sheet_year(pg_catalog.now(), w.timezone) from public.workspaces w where w.id = p_workspace)]);
end;
$$;

-- workers_due and sheet_claim: latest bodies from 20261011094523_m7_sheet_worker.sql. They spell out
-- the due index's own columns (active, retry time passed) next to private.sheet_due, which stays the
-- one rule: a function with its own search_path is never inlined, so without them
-- sheet_syncs_due_idx could serve neither read.
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
$$;

create or replace function public.sheet_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with picked as (
    select s.workspace_id from public.sheet_syncs s
    where s.status = 'active' and s.retry_at <= pg_catalog.now() and private.sheet_due(s)
    order by s.retry_at
    limit p_limit
    for update of s skip locked
  ), leased as (
    update public.sheet_syncs s
    set run_id = p_run, locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where s.workspace_id = picked.workspace_id
    returning s.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspace_id', l.workspace_id, 'workspace_name', w.name, 'workspace_slug', w.slug,
    'timezone', w.timezone, 'locale', w.locale, 'spreadsheet_id', l.spreadsheet_id, 'create_key', l.create_key,
    'connection', case when c.id is null then null else pg_catalog.jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'google_sub', c.google_sub,
      'refresh_token_encrypted', c.refresh_token_encrypted, 'granted_scopes', c.granted_scopes) end,
    'years', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('year', d.year, 'version', d.version) order by d.year desc)
      from public.sheet_dirty_years d where d.workspace_id = l.workspace_id), '[]'::jsonb),
    'tabs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'tab_key', t.tab_key, 'year', t.year, 'google_sheet_id', t.google_sheet_id, 'title', t.title,
        'content_hash', t.content_hash, 'row_count', t.row_count, 'format_version', t.format_version)
        order by t.year desc, t.tab_key)
      from public.sheet_tabs t where t.workspace_id = l.workspace_id), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_rows
  from leased l
  join public.workspaces w on w.id = l.workspace_id
  left join public.google_connections c on c.id = l.connection_id;
  return v_rows;
end;
$$;

-- "Checked in by" shows the marker's profile name: renaming that person marks every year in which
-- they checked someone in (#291).
create function private.sheet_profiles_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  perform private.sheet_mark_meetings(array(
    select distinct am.meeting_id
    from new_rows n
    join old_rows o on o.user_id = n.user_id
    join public.attendance_marks am on am.marked_by = n.user_id
    where o.display_name is distinct from n.display_name));
  return null;
end;
$$;
create trigger sheet_profiles_updated after update on public.profiles
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_profiles_changed();
revoke execute on function private.sheet_profiles_changed() from public, anon, authenticated;
