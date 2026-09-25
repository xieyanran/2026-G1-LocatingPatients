-- Issue #6: close the Realtime postgres_changes name-leak gap for
-- protected patients. mapPatientRow() (lib/supabase/patients.ts) masks a
-- protected patient's name to "XXXX" at the data-mapping boundary, but that
-- only covers page render / initial load. The raw `postgres_changes` stream
-- sends the full row — real name included — over the websocket before
-- mapPatientRow ever runs client-side, and because it rides the WAL-based
-- `supabase_realtime` publication, any authenticated client can subscribe
-- to it directly (bypassing our own client code) and read the real name
-- out of the raw frames when it changes live.
--
-- Fix: stop publishing `patients` for postgres_changes, and instead emit a
-- pre-masked payload via realtime.broadcast_changes() from a trigger, over
-- a private channel authorized by RLS on realtime.messages. The client
-- moves from `.on('postgres_changes', ...)` to `.on('broadcast', ...)` on a
-- `{ config: { private: true } }` channel named "patients-changes" — see
-- lib/components/{ward-board,patient-list,planning-board}.tsx.

-- `patients` no longer needs to ride the postgres_changes replication
-- stream at all — this is what let a client subscribe to the raw,
-- unmasked row stream directly.
alter publication supabase_realtime drop table patients;

create function public.patients_broadcast_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  masked_new patients;
  masked_old patients;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    masked_new := new;
    if masked_new.protected_identity then
      masked_new.name := 'XXXX';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    masked_old := old;
    if masked_old.protected_identity then
      masked_old.name := 'XXXX';
    end if;
  end if;

  perform realtime.broadcast_changes(
    'patients-changes',  -- topic: one shared topic, same as the old unfiltered postgres_changes subscription
    tg_op,                -- event
    tg_op,                -- operation
    tg_table_name,         -- table
    tg_table_schema,       -- schema
    masked_new,
    masked_old
  );

  return coalesce(new, old);
end;
$$;

create trigger patients_broadcast_changes
after insert or update or delete on patients
for each row execute function public.patients_broadcast_changes();

-- Authorize staff to receive broadcasts on the "patients-changes" topic —
-- same read gate as patients_select in 20260920100200_enable_rls.sql, since
-- this broadcast now carries the same (masked) row data that policy guards.
create policy "patients_changes_broadcast_select" on "realtime"."messages"
for select to authenticated
using (
  realtime.topic() = 'patients-changes'
  and public.current_user_role() is not null
);
