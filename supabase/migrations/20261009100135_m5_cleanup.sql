-- M5 cleanup: the meeting page reads send progress from meeting_results (Task 13 removed the
-- /progress route and hook), so meeting_progress has no callers left.
drop function public.meeting_progress(uuid);
drop function private.meeting_progress(uuid);
