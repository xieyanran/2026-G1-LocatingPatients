-- Audit trail for patient records (PRD 6: "Data privacy and data integrity"
-- is called out as an open risk). Implemented as a DB trigger, not app-level
-- logging, so it can't be skipped by a direct API call that bypasses the
-- Next.js server actions.
--
-- Scoped to `patients` only. The planning-board tables (bed_events,
-- board_plans, board_beds, patient_list_entries) are saved via a
-- delete-all-then-reinsert pattern (lib/supabase/planning.server.ts), so a
-- row-level trigger there would just log "everything replaced" on every
-- save rather than a meaningful diff — not useful as an audit trail.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  patient_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table audit_logs enable row level security;

-- Only coordinator/admin can read the audit trail. There is deliberately no
-- insert/update/delete policy for authenticated/anon — the only writer is
-- the security-definer trigger function below, so even a coordinator or
-- admin calling the API directly cannot fabricate or edit audit rows.
create policy "audit_logs_select" on audit_logs
for select to authenticated
using (public.current_user_role() in ('coordinator', 'admin'));

create function public.log_patient_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, patient_id, old_value, new_value
  )
  values (
    auth.uid(),
    public.current_user_role(),
    tg_op,
    'patients',
    coalesce(new.id, old.id)::text,
    coalesce(new.id, old.id),
    case when tg_op in ('DELETE', 'UPDATE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger patients_audit
after insert or update or delete on patients
for each row execute function public.log_patient_change();
