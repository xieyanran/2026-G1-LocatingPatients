-- Issue #12: nothing stopped two patients from ending up in the same bed.
--
-- setPatientLocation() (lib/supabase/patients.server.ts) does a plain
-- `update ... set location_room, location_bed`, with no check that the bed
-- is free first — so two concurrent moves onto the same empty bed (two
-- nurses dragging different patients onto it at the same time) could both
-- succeed, silently double-booking it. Checking "is this bed free?" in the
-- application before writing doesn't close the race: both requests can pass
-- that check before either write lands. Postgres itself has to be the
-- thing that rejects the second write.
--
-- A plain UNIQUE constraint on (location_room, location_bed) does that —
-- and needs no partial/WHERE clause to exempt unassigned patients, because
-- standard SQL unique semantics already treat NULL as distinct from every
-- other NULL, so any number of (null, null) rows coexist freely.
--
-- It's declared DEFERRABLE (checked at COMMIT, not after every statement)
-- but INITIALLY IMMEDIATE, so ordinary single-row writes (addPatient,
-- setPatientLocation, editPatient) keep failing fast, statement by
-- statement, the moment they'd double-book a bed.
--
-- The one legitimate case that *needs* deferred checking is swapping two
-- patients into each other's beds: written as two straight UPDATEs, the
-- first one always collides with the second patient still sitting in the
-- destination bed. swap_patient_locations() below defers this constraint
-- for its own transaction, so only the *final* state — both patients in
-- their new, still-distinct beds — gets checked.
alter table patients
  add constraint patients_location_occupied_key
  unique (location_room, location_bed)
  deferrable initially immediate;

-- Runs as the calling user (no `security definer`), so the normal
-- `patients_update` RLS policy and the
-- `enforce_nurse_column_restrictions` trigger (a nurse may swap beds, same
-- as any single-patient move) still apply to both updates below.
create function public.swap_patient_locations(patient_a_id uuid, patient_b_id uuid)
returns void
language plpgsql
as $$
declare
  a_room text;
  a_bed integer;
  b_room text;
  b_bed integer;
begin
  set constraints patients_location_occupied_key deferred;

  select location_room, location_bed into a_room, a_bed
    from patients where id = patient_a_id;
  if not found then
    raise exception 'Patient % not found', patient_a_id;
  end if;

  select location_room, location_bed into b_room, b_bed
    from patients where id = patient_b_id;
  if not found then
    raise exception 'Patient % not found', patient_b_id;
  end if;

  update patients set location_room = b_room, location_bed = b_bed where id = patient_a_id;
  update patients set location_room = a_room, location_bed = a_bed where id = patient_b_id;
end;
$$;

grant execute on function public.swap_patient_locations(uuid, uuid) to authenticated;
