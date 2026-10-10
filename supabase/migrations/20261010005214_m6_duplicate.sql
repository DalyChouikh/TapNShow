-- M6 Duplicate (spec §7.9): a new draft with the same details, audience, answer and reminder
-- settings, and no date, time or deadline.
create function private.duplicate_meeting(p_meeting uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.meetings;
  v_id uuid;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  if v.id is null or not private.is_member(v.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_create') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.meetings (
    workspace_id, title, agenda_md, duration_minutes, timezone, location_mode, location_text, online_text,
    meeting_url, response_mode, delay_options, reason_required, comments_enabled, footer_note,
    reminder_pending_hours, reminder_going_hours, created_by
  )
  values (
    v.workspace_id, v.title, v.agenda_md, v.duration_minutes, v.timezone, v.location_mode, v.location_text,
    v.online_text, v.meeting_url, v.response_mode, v.delay_options, v.reason_required, v.comments_enabled,
    v.footer_note, v.reminder_pending_hours, v.reminder_going_hours, auth.uid()
  )
  returning id into v_id;
  insert into public.meeting_audience (workspace_id, meeting_id, list_id)
  select a.workspace_id, v_id, a.list_id from public.meeting_audience a where a.meeting_id = p_meeting;
  insert into public.meeting_audience_people (workspace_id, meeting_id, contact_id, mode)
  select p.workspace_id, v_id, p.contact_id, p.mode from public.meeting_audience_people p where p.meeting_id = p_meeting;
  return v_id;
end;
$$;
revoke execute on function private.duplicate_meeting(uuid) from public, anon;
grant execute on function private.duplicate_meeting(uuid) to authenticated;
create function public.duplicate_meeting(p_meeting uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.duplicate_meeting(p_meeting) $$;
revoke execute on function public.duplicate_meeting(uuid) from public, anon;
grant execute on function public.duplicate_meeting(uuid) to authenticated;
