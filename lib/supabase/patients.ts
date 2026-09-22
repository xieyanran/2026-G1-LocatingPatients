import type { Patient, PatientLocation } from '@/lib/data/patients/types'
import type { Tables } from './types'

type PatientRow = Tables<'patients'>

/** PRD 4.1 (Must Have): a protected-identity patient's name is "XXXX" for
 * every viewer, in every role — there is no unmask capability. This masks
 * at the data boundary (not just at render time) so the real name is never
 * put into a client component's props/state in the first place; it isn't
 * something a page could accidentally render unmasked, or that a viewer
 * could read out of React devtools.
 *
 * Known gap: this does not cover Supabase Realtime's `postgres_changes`
 * stream, which sends the full row (including the real name) over the
 * websocket before this mapper runs. Closing that would mean moving
 * realtime updates to a masked `realtime.broadcast_changes()` payload
 * instead of raw `postgres_changes` — real work, not done in this pass. */
export function mapPatientRow(row: PatientRow): Patient {
  return {
    id: row.id,
    name: row.protected_identity ? 'XXXX' : row.name,
    note: row.note,
    plannedOperation: row.planned_operation,
    plannedCheckIn: row.planned_check_in,
    plannedCheckOut: row.planned_check_out,
    location:
      row.location_room != null && row.location_bed != null
        ? { room: row.location_room as PatientLocation['room'], bed: row.location_bed }
        : null,
    personalNumber: row.personal_number,
    careLevel:
      row.care_level_medicine != null && row.care_level_nursing != null
        ? {
            medicine: row.care_level_medicine as 'A' | 'B' | 'C',
            nursing: row.care_level_nursing as 1 | 2 | 3,
          }
        : null,
    quickIcons: (row.quick_icons ?? []) as Patient['quickIcons'],
    protectedIdentity: row.protected_identity,
  }
}
