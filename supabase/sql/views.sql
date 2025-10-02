-- Dračí smyčka derived views

drop view if exists relay_leaderboards cascade;
drop view if exists relay_node_rankings cascade;
drop view if exists category_leaderboards cascade;
drop view if exists category_overall_scores cascade;
drop view if exists category_node_rankings cascade;
drop view if exists node_attempt_best cascade;
drop view if exists events_public cascade;

-- Public event metadata -----------------------------------------------------

create or replace view events_public as
select
  e.id,
  e.name,
  e.slug,
  e.base_path,
  e.starts_at,
  e.ends_at
from events e;

grant select on events_public to anon, authenticated;

-- Best attempts per competitor/node ----------------------------------------

create or replace view node_attempt_best as
select
  a.event_id,
  a.node_id,
  a.competitor_id,
  min(a.centiseconds) filter (where a.result_kind = 'time') as best_centiseconds,
  coalesce(bool_or(a.result_kind = 'fault'), false) as has_fault,
  (count(*) > 0) as has_any_attempt
from attempts a
group by
  a.event_id,
  a.node_id,
  a.competitor_id;

-- Node rankings within category --------------------------------------------

create or replace view category_node_rankings as
with base as (
  select
    cn.event_id,
    cn.category_code,
    cn.node_id,
    cn.sequence,
    c.id as competitor_id,
    nb.best_centiseconds,
    coalesce(nb.has_fault, false) as has_fault,
    coalesce(nb.has_any_attempt, false) as has_any_attempt
  from category_nodes cn
  join competitors c on c.event_id = cn.event_id and c.category_code = cn.category_code
  left join node_attempt_best nb on nb.event_id = cn.event_id and nb.node_id = cn.node_id and nb.competitor_id = c.id
), ranked as (
  select
    b.*,
    case
      when b.best_centiseconds is not null then dense_rank() over (
        partition by b.event_id, b.category_code, b.node_id
        order by b.best_centiseconds asc
      )
      else null
    end as time_rank,
    count(*) filter (where b.best_centiseconds is not null) over (
      partition by b.event_id, b.category_code, b.node_id
    ) as finisher_count,
    count(*) over (
      partition by b.event_id, b.category_code, b.node_id
    ) as competitor_count
  from base b
)
select
  r.event_id,
  r.category_code,
  r.node_id,
  r.sequence,
  r.competitor_id,
  r.best_centiseconds,
  r.has_fault,
  r.has_any_attempt,
  case
    when r.best_centiseconds is not null then 'time'
    when r.has_fault then 'fault'
    when r.has_any_attempt then 'incomplete'
    else 'missing'
  end as status,
  r.time_rank,
  r.competitor_count,
  case
    when r.best_centiseconds is not null then r.time_rank
    else r.competitor_count
  end as placement,
  case
    when r.best_centiseconds is not null then r.best_centiseconds
    else null
  end as tie_break_centiseconds
from ranked r;

-- Overall scores by category ------------------------------------------------

create or replace view category_overall_scores as
with ranked as (
  select
    r.*,
    n.counts_to_overall,
    n.is_relay
  from category_node_rankings r
  join nodes n on n.id = r.node_id
)
select
  ranked.event_id,
  ranked.category_code,
  ranked.competitor_id,
  sum(case when ranked.counts_to_overall then ranked.placement else 0 end) as placement_sum,
  sum(case when ranked.counts_to_overall then ranked.tie_break_centiseconds else 0 end) as tie_break_centiseconds_sum,
  count(*) filter (where ranked.counts_to_overall) as counted_nodes,
  bool_or(ranked.status <> 'time') filter (where ranked.counts_to_overall) as has_non_time,
  max(ranked.competitor_count) filter (where ranked.counts_to_overall) as competitor_count
from ranked
group by
  ranked.event_id,
  ranked.category_code,
  ranked.competitor_id;

-- Category leaderboard with ranking ----------------------------------------

create or replace view category_leaderboards as
with totals as (
  select
    cos.event_id,
    cos.category_code,
    cos.competitor_id,
    cos.placement_sum,
    cos.tie_break_centiseconds_sum,
    cos.counted_nodes,
    coalesce(cos.has_non_time, false) as has_non_time,
    coalesce(cos.competitor_count, sub.count_in_category) as competitor_count
  from category_overall_scores cos
  join (
    select event_id, category_code, count(*) as count_in_category
    from competitors
    group by event_id, category_code
  ) sub on sub.event_id = cos.event_id and sub.category_code = cos.category_code
)
select
  totals.event_id,
  totals.category_code,
  totals.competitor_id,
  totals.placement_sum,
  totals.tie_break_centiseconds_sum,
  totals.counted_nodes,
  totals.has_non_time,
  totals.competitor_count,
  dense_rank() over (
    partition by totals.event_id, totals.category_code
    order by totals.placement_sum asc, totals.tie_break_centiseconds_sum asc
  ) as overall_rank
from totals;

-- Relay specific leaderboards ----------------------------------------------

create or replace view relay_node_rankings as
select
  r.event_id,
  r.category_code,
  r.node_id,
  r.sequence,
  r.competitor_id,
  r.best_centiseconds,
  r.has_fault,
  r.has_any_attempt,
  r.status,
  r.time_rank,
  r.competitor_count,
  r.placement,
  r.tie_break_centiseconds
from category_node_rankings r
join nodes n on n.id = r.node_id
where n.is_relay;

create or replace view relay_leaderboards as
with base as (
  select
    r.event_id,
    r.category_code,
    r.competitor_id,
    sum(r.placement) as placement_sum,
    sum(r.tie_break_centiseconds) as tie_break_centiseconds_sum,
    count(*) as counted_nodes,
    max(r.competitor_count) as competitor_count
  from relay_node_rankings r
  group by
    r.event_id,
    r.category_code,
    r.competitor_id
)
select
  base.event_id,
  base.category_code,
  base.competitor_id,
  base.placement_sum,
  base.tie_break_centiseconds_sum,
  base.counted_nodes,
  base.competitor_count,
  dense_rank() over (
    partition by base.event_id, base.category_code
    order by base.placement_sum asc, base.tie_break_centiseconds_sum asc
  ) as relay_rank
from base;

grant select on node_attempt_best to authenticated;
grant select on category_node_rankings to authenticated;
grant select on category_overall_scores to authenticated;
grant select on category_leaderboards to anon, authenticated;
grant select on relay_node_rankings to authenticated;
grant select on relay_leaderboards to anon, authenticated;
