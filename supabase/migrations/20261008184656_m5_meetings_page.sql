-- M5 / #174: the Meetings tabs load in pages (keyset), with invite and answer counts per card.

create index meetings_ws_status_starts_idx on public.meetings (workspace_id, status, starts_at, id);
create index meetings_ws_status_updated_idx on public.meetings (workspace_id, status, updated_at, id);

-- Definer body (one membership check, then no per-row RLS probes; spec §6 Access pattern (M5)) behind
-- a public invoker wrapper (spec §11).
create function private.meetings_page(
  p_workspace uuid,
  p_tab text,
  p_after_key timestamptz,
  p_after_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_ids uuid[];
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_tab not in ('upcoming', 'past', 'drafts') or p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;

  -- One indexed keyset scan per tab (no OFFSET); limit + 1 rows tell whether a next page exists.
  if p_tab = 'upcoming' then
    select coalesce(pg_catalog.array_agg(x.id order by x.starts_at, x.id), '{}') into v_ids
    from (
      select m.id, m.starts_at from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'scheduled'
        and m.starts_at > v_now - interval '12 hours'
        and m.starts_at + pg_catalog.make_interval(mins => m.duration_minutes) > v_now
        and (p_after_id is null or (m.starts_at, m.id) > (p_after_key, p_after_id))
      order by m.starts_at, m.id
      limit p_limit + 1
    ) x;
  elsif p_tab = 'past' then
    select coalesce(pg_catalog.array_agg(x.id order by x.starts_at desc, x.id desc), '{}') into v_ids
    from (
      select m.id, m.starts_at from public.meetings m
      where m.workspace_id = p_workspace and m.status in ('scheduled', 'cancelled')
        and (m.status = 'cancelled' or m.starts_at + pg_catalog.make_interval(mins => m.duration_minutes) <= v_now)
        and (p_after_id is null or (m.starts_at, m.id) < (p_after_key, p_after_id))
      order by m.starts_at desc, m.id desc
      limit p_limit + 1
    ) x;
  else
    select coalesce(pg_catalog.array_agg(x.id order by x.updated_at desc, x.id desc), '{}') into v_ids
    from (
      select m.id, m.updated_at from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'draft' and (m.title <> '' or m.starts_at is not null)
        and (p_after_id is null or (m.updated_at, m.id) < (p_after_key, p_after_id))
      order by m.updated_at desc, m.id desc
      limit p_limit + 1
    ) x;
  end if;

  return pg_catalog.jsonb_build_object(
    'has_more', pg_catalog.cardinality(v_ids) > p_limit,
    'items', coalesce((
      with page as (
        select u.id, u.ord from pg_catalog.unnest(v_ids) with ordinality as u(id, ord) where u.ord <= p_limit
      ), counts as materialized (
        select i.meeting_id,
          count(*) as invited,
          count(*) filter (where i.email_status = 'sent') as sent,
          count(*) filter (where i.email_status = 'queued') as queued,
          count(r.id) filter (where r.status = 'attending') as attending,
          count(r.id) filter (where r.status = 'late') as late,
          count(r.id) filter (where r.status in ('absent', 'not_attending')) as absent,
          count(*) filter (where r.id is null and i.email_status in ('sent', 'unknown')) as no_reply
        from public.meeting_invitees i
        left join public.responses r on r.invitee_id = i.id
        where i.meeting_id in (select page.id from page)
        group by i.meeting_id
      )
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone,
          'duration_minutes', m.duration_minutes, 'status', m.status, 'location_mode', m.location_mode,
          'response_mode', m.response_mode,
          'sort_key', case when p_tab = 'drafts' then m.updated_at else m.starts_at end,
          'counts', pg_catalog.jsonb_build_object(
            'invited', coalesce(c.invited, 0), 'sent', coalesce(c.sent, 0), 'queued', coalesce(c.queued, 0),
            'attending', coalesce(c.attending, 0), 'late', coalesce(c.late, 0),
            'absent', coalesce(c.absent, 0), 'no_reply', coalesce(c.no_reply, 0)
          )
        )
        order by page.ord
      )
      from page
      join public.meetings m on m.id = page.id
      left join counts c on c.meeting_id = m.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function private.meetings_page(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function private.meetings_page(uuid, text, timestamptz, uuid, integer) to authenticated;

create function public.meetings_page(
  p_workspace uuid,
  p_tab text,
  p_after_key timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.meetings_page(p_workspace, p_tab, p_after_key, p_after_id, p_limit) $$;
revoke execute on function public.meetings_page(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.meetings_page(uuid, text, timestamptz, uuid, integer) to authenticated;
