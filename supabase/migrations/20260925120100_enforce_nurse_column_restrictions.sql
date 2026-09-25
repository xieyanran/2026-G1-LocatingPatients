-- Issue #7: DB-enforced column-level RBAC for nurse edits.
--
-- 20260920100200_enable_rls.sql's scope note flagged that RLS on `patients`
-- is row-level only (can a nurse UPDATE this row at all), not column-level
-- (which columns) — the restriction of a nurse to location/care-level/
-- quick-icon fields was enforced only in lib/supabase/patients.server.ts's
-- editPatient(), so it held only as long as every write went through that
-- Server Action DAL.
--
-- Rather than the heavier per-role Postgres column GRANTs driven by a
-- custom JWT claim / access token hook that issue #7 raised as the "real"
-- design, this closes the gap with a trigger that mirrors editPatient's
-- own restrictedChanges check inside Postgres itself: a nurse can still
-- reach the row via any path, but a write that actually changes a
-- restricted column is now rejected by the database, not just the app.
create function public.enforce_nurse_column_restrictions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() = 'nurse' then
    if new.name is distinct from old.name
      or new.note is distinct from old.note
      or new.planned_operation is distinct from old.planned_operation
      or new.planned_check_in is distinct from old.planned_check_in
      or new.planned_check_out is distinct from old.planned_check_out
      or new.personal_number is distinct from old.personal_number
      or new.protected_identity is distinct from old.protected_identity
    then
      raise exception 'Forbidden: nurse can only edit location, care level and flags';
    end if;
  end if;
  return new;
end;
$$;

create trigger patients_enforce_nurse_column_restrictions
before update on patients
for each row execute function public.enforce_nurse_column_restrictions();
