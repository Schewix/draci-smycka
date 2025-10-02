-- Dračí smyčka core schema

-- Enums --------------------------------------------------------------------

do $$ begin
  create type user_role as enum ('admin', 'judge', 'calculator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type category_code as enum ('N', 'M', 'S', 'R');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attempt_result_kind as enum ('time', 'fault');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_action as enum (
    'attempt_created',
    'attempt_updated',
    'attempt_deleted',
    'token_generated',
    'token_revoked',
    'competitor_updated'
  );
exception when duplicate_object then null; end $$;

-- Core tables ---------------------------------------------------------------

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  base_path text not null default '/draci-smycka',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  role user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Helper domain tables ------------------------------------------------------

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  code category_code not null,
  name text not null,
  description text,
  display_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, code)
);

create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  code text not null,
  name text not null,
  sequence int not null default 100,
  is_relay boolean not null default false,
  counts_to_overall boolean not null default true,
  max_time_centiseconds int,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, code)
);

create index if not exists nodes_event_sequence_idx on nodes(event_id, sequence);

create table if not exists user_event_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  role user_role not null,
  node_id uuid references nodes(id) on delete cascade,
  allowed_category_codes category_code[] not null default array[]::category_code[],
  created_at timestamptz not null default now()
);

create unique index if not exists user_event_roles_unique
  on user_event_roles (user_id, event_id, role, coalesce(node_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists category_nodes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  category_code category_code not null,
  node_id uuid not null references nodes(id) on delete cascade,
  sequence int not null default 100,
  created_at timestamptz not null default now(),
  unique (event_id, category_code, node_id)
);

alter table category_nodes drop constraint if exists category_nodes_category_fkey;
alter table category_nodes
  add constraint category_nodes_category_fkey
  foreign key (event_id, category_code)
  references categories(event_id, code)
  on delete cascade;

create index if not exists category_nodes_event_category_idx on category_nodes(event_id, category_code, sequence);

create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  category_code category_code not null,
  display_name text not null,
  club text,
  start_number int,
  birth_year int,
  notes text,
  qr_token text,
  qr_token_issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, start_number)
);

alter table competitors drop constraint if exists competitors_category_fkey;
alter table competitors
  add constraint competitors_category_fkey
  foreign key (event_id, category_code)
  references categories(event_id, code)
  on delete cascade;

create unique index if not exists competitors_event_token_unique
  on competitors(event_id, qr_token)
  where qr_token is not null;

create index if not exists competitors_event_category_idx on competitors(event_id, category_code);

create table if not exists qr_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,
  token text not null,
  issued_by uuid references users(id) on delete set null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (event_id, token)
);

create index if not exists qr_tokens_competitor_idx on qr_tokens(competitor_id);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,
  node_id uuid not null references nodes(id) on delete cascade,
  attempt_number smallint not null,
  result_kind attempt_result_kind not null,
  centiseconds int,
  fault_code text,
  note text,
  locked boolean not null default false,
  recorded_by uuid references users(id) on delete set null,
  recorded_role user_role,
  recorded_ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, competitor_id, node_id, attempt_number),
  constraint attempts_attempt_number_check check (attempt_number in (1,2)),
  constraint attempts_time_check check (
    (result_kind = 'time' and centiseconds is not null)
    or (result_kind <> 'time' and centiseconds is null)
  )
);

create index if not exists attempts_event_node_idx on attempts(event_id, node_id);
create index if not exists attempts_competitor_idx on attempts(competitor_id);

create table if not exists attempt_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  attempt_id uuid references attempts(id) on delete set null,
  competitor_id uuid references competitors(id) on delete set null,
  node_id uuid references nodes(id) on delete set null,
  attempt_number smallint,
  action audit_action not null,
  previous_value jsonb,
  new_value jsonb,
  changed_by uuid references users(id) on delete set null,
  changed_role user_role,
  changed_ip inet,
  created_at timestamptz not null default now()
);

create index if not exists attempt_audit_event_idx on attempt_audit_logs(event_id, created_at desc);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  role user_role not null,
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  device_info text,
  created_ip inet,
  revoked_at timestamptz
);

create index if not exists user_sessions_user_idx on user_sessions(user_id);
create index if not exists user_sessions_event_idx on user_sessions(event_id);

create table if not exists seed_history (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  applied_at timestamptz not null default now()
);

-- Utility view support: ensure stable updated_at triggers -------------------

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'set_updated_at_row'
  ) then
    create function set_updated_at_row() returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql;
  end if;
end;
$$;

create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at_row();

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at_row();

create trigger categories_set_updated_at
  before update on categories
  for each row execute function set_updated_at_row();

create trigger nodes_set_updated_at
  before update on nodes
  for each row execute function set_updated_at_row();

create trigger competitors_set_updated_at
  before update on competitors
  for each row execute function set_updated_at_row();

create trigger attempts_set_updated_at
  before update on attempts
  for each row execute function set_updated_at_row();
