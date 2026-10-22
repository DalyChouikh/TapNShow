-- #413 Task 7: sharing the Google Sheet with the workspace's team, switched on. Google approved the
-- OAuth verification on 2026-10-22; the privacy policy update ships in the same release
-- (design §5). The switch stays, so a later migration can turn sharing off again.
update private.app_flags set enabled = true where name = 'sheet_team_sharing';

-- Every existing sheet is shared at switch-on (design §7). 20261020203846 already marked the sheets
-- of that day and the triggers mark the newer ones; marking again keeps the rule true whatever
-- happened to a mark since.
select private.sheet_shares_mark(array(select s.workspace_id from public.sheet_syncs s));
