-- Before this migration, these tables have RLS off and the default
-- `GRANT ALL ON TABLES TO anon, authenticated` from the initial remote
-- schema dump applies — i.e. anyone with the published anon key can read
-- and write every patient record. This migration makes Postgres the real
-- access boundary.
--
-- Scope note: RLS here is enforced per-row, keyed on the caller's role
-- (public.current_user_role(), from 20260920100000_add_user_roles.sql).
-- It is NOT column-level — e.g. a nurse can UPDATE any column on a row they
-- have UPDATE access to at the database level. Restricting nurses to only
-- location/care-level fields is enforced in the application's data-access
-- layer (lib/supabase/patients.server.ts), not by Postgres. True DB-enforced
-- column-level RBAC would need per-role Postgres grants driven by custom JWT
-- claims, which is more infrastructure than this prototype needs yet.

alter table patients enable row level security;
alter table bed_events enable row level security;
alter table patient_list_entries enable row level security;
alter table board_plans enable row level security;
alter table board_beds enable row level security;

-- ── patients ─────────────────────────────────────────────────────────────
-- All primary PRD personas (nurse, doctor, coordinator) read the ward board.
create policy "patients_select" on patients
for select to authenticated
using (public.current_user_role() is not null);

create policy "patients_insert" on patients
for insert to authenticated
with check (public.current_user_role() in ('coordinator', 'admin'));

create policy "patients_update" on patients
for update to authenticated
using (public.current_user_role() in ('nurse', 'coordinator', 'admin'))
with check (public.current_user_role() in ('nurse', 'coordinator', 'admin'));

create policy "patients_delete" on patients
for delete to authenticated
using (public.current_user_role() in ('coordinator', 'admin'));

-- ── planning board tables (bed_events, patient_list_entries, board_plans,
--    board_beds) ────────────────────────────────────────────────────────
-- Same read/write split for all four: any staff role reads, doctors are
-- read-only, everyone else can edit the plan.
create policy "bed_events_select" on bed_events
for select to authenticated
using (public.current_user_role() is not null);

create policy "bed_events_write" on bed_events
for all to authenticated
using (public.current_user_role() in ('nurse', 'coordinator', 'admin'))
with check (public.current_user_role() in ('nurse', 'coordinator', 'admin'));

create policy "patient_list_entries_select" on patient_list_entries
for select to authenticated
using (public.current_user_role() is not null);

create policy "patient_list_entries_write" on patient_list_entries
for all to authenticated
using (public.current_user_role() in ('nurse', 'coordinator', 'admin'))
with check (public.current_user_role() in ('nurse', 'coordinator', 'admin'));

create policy "board_plans_select" on board_plans
for select to authenticated
using (public.current_user_role() is not null);

create policy "board_plans_write" on board_plans
for all to authenticated
using (public.current_user_role() in ('nurse', 'coordinator', 'admin'))
with check (public.current_user_role() in ('nurse', 'coordinator', 'admin'));

create policy "board_beds_select" on board_beds
for select to authenticated
using (public.current_user_role() is not null);

create policy "board_beds_write" on board_beds
for all to authenticated
using (public.current_user_role() in ('nurse', 'coordinator', 'admin'))
with check (public.current_user_role() in ('nurse', 'coordinator', 'admin'));
