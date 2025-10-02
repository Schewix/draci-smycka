-- Row level security configuration for Dračí smyčka

-- Enable RLS ----------------------------------------------------------------
alter table events enable row level security;
alter table users enable row level security;
alter table categories enable row level security;
alter table nodes enable row level security;
alter table user_event_roles enable row level security;
alter table category_nodes enable row level security;
alter table competitors enable row level security;
alter table qr_tokens enable row level security;
alter table attempts enable row level security;
alter table attempt_audit_logs enable row level security;
alter table user_sessions enable row level security;

-- Events --------------------------------------------------------------------

drop policy if exists events_read_all on events;
create policy events_read_all on events
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

-- Users ---------------------------------------------------------------------

drop policy if exists users_read_authenticated on users;
create policy users_read_authenticated on users
  for select using (auth.role() in ('authenticated', 'service_role'));

-- Categories ----------------------------------------------------------------

drop policy if exists categories_read_all on categories;
create policy categories_read_all on categories
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

-- Nodes ---------------------------------------------------------------------

drop policy if exists nodes_read_all on nodes;
create policy nodes_read_all on nodes
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

-- User event roles ----------------------------------------------------------

drop policy if exists user_event_roles_read_authenticated on user_event_roles;
create policy user_event_roles_read_authenticated on user_event_roles
  for select using (auth.role() in ('authenticated', 'service_role'));

-- Category nodes ------------------------------------------------------------

drop policy if exists category_nodes_read_all on category_nodes;
create policy category_nodes_read_all on category_nodes
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

-- Competitors ---------------------------------------------------------------

drop policy if exists competitors_read_all on competitors;
create policy competitors_read_all on competitors
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

-- QR tokens -----------------------------------------------------------------

drop policy if exists qr_tokens_read_authenticated on qr_tokens;
create policy qr_tokens_read_authenticated on qr_tokens
  for select using (auth.role() in ('authenticated', 'service_role'));

-- Attempts ------------------------------------------------------------------

drop policy if exists attempts_read_authenticated on attempts;
create policy attempts_read_authenticated on attempts
  for select using (auth.role() in ('authenticated', 'service_role'));

-- Attempt audit logs --------------------------------------------------------

drop policy if exists attempt_audit_logs_read_authenticated on attempt_audit_logs;
create policy attempt_audit_logs_read_authenticated on attempt_audit_logs
  for select using (auth.role() in ('authenticated', 'service_role'));

-- User sessions -----------------------------------------------------------

drop policy if exists user_sessions_read_self on user_sessions;
create policy user_sessions_read_self on user_sessions
  for select using (auth.role() in ('authenticated', 'service_role')
    and auth.jwt()->>'sub' = user_id::text);
