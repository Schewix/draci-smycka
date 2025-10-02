-- Seed data for Dračí smyčka default event configuration

with upsert_event as (
  insert into events (name, slug, base_path, starts_at, ends_at)
  values ('Dračí smyčka', 'draci-smycka', '/draci-smycka', null, null)
  on conflict (slug) do update
  set name = excluded.name,
      base_path = excluded.base_path
  returning id
), event_cte as (
  select id as event_id from upsert_event
)
-- Categories --------------------------------------------------------------
insert into categories (event_id, code, name, description, display_order)
select event_id, code, name, description, display_order
from event_cte
cross join (values
  ('N'::category_code, 'Nováčci', 'Nejmladší kategorie', 1),
  ('M'::category_code, 'Mladší', 'Mladší závodníci', 2),
  ('S'::category_code, 'Starší', 'Starší závodníci', 3),
  ('R'::category_code, 'Roveři', 'Nejstarší kategorie', 4)
) as v(code, name, description, display_order)
on conflict (event_id, code) do update
set name = excluded.name,
    description = excluded.description,
    display_order = excluded.display_order;

with event_cte as (
  select id as event_id from events where slug = 'draci-smycka'
)
insert into nodes (event_id, code, name, sequence, is_relay, counts_to_overall, max_time_centiseconds)
select event_id, code, name, sequence, is_relay, counts_to_overall, max_time_centiseconds
from event_cte
cross join (values
  ('AMB','Ambulanční uzel', 10, false, true, 120000),
  ('LOD','Lodní smyčka', 20, false, true, 120000),
  ('OSM','Osmičková smyčka', 30, false, true, 120000),
  ('RYB','Rybářský uzel', 40, false, true, 120000),
  ('ZKR','Zkracovačka', 50, false, true, 120000),
  ('STF','Štafeta', 60, true, false, 60000)
) as v(code, name, sequence, is_relay, counts_to_overall, max_time_centiseconds)
on conflict (event_id, code) do update
set name = excluded.name,
    sequence = excluded.sequence,
    is_relay = excluded.is_relay,
    counts_to_overall = excluded.counts_to_overall,
    max_time_centiseconds = excluded.max_time_centiseconds;

with event_cte as (
  select id as event_id from events where slug = 'draci-smycka'
), category_map as (
  select
    c.event_id,
    c.code,
    case c.code
      when 'N' then array['AMB', 'LOD', 'OSM', 'STF']
      when 'M' then array['AMB', 'LOD', 'OSM', 'RYB', 'STF']
      when 'S' then array['AMB', 'LOD', 'OSM', 'RYB', 'ZKR', 'STF']
      when 'R' then array['AMB', 'LOD', 'OSM', 'RYB', 'ZKR', 'STF']
    end as node_codes
  from categories c
  join event_cte e on e.event_id = c.event_id
)
insert into category_nodes (event_id, category_code, node_id, sequence)
select
  cm.event_id,
  cm.code,
  n.id,
  dense_rank() over (partition by cm.event_id, cm.code order by idx)
from category_map cm
cross join lateral unnest(cm.node_codes) with ordinality as nodes(code, idx)
join nodes n on n.event_id = cm.event_id and n.code = nodes.code
on conflict (event_id, category_code, node_id) do update
set sequence = excluded.sequence;

insert into seed_history (tag)
values ('draci_smycka_seed')
on conflict (tag) do nothing;
