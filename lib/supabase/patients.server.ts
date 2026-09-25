import 'server-only'
import { createClient } from './server'
import { requireRole } from '@/lib/auth/session'
import type { CreatePatientInput, UpdatePatientInput, PatientLocation } from '@/lib/data/patients/types'
import { CreatePatientInputSchema, UpdatePatientInputSchema } from '@/lib/data/patients/types'
import type { TablesUpdate } from './types'

// A `nurse` may only change location, care level and quick-icon flags via
// editPatient() — see the restrictedChanges check below. Everything else
// (name, note, dates, personal number, protected-identity flag) requires
// coordinator/admin. This check is duplicated at the database level by a
// trigger (supabase/migrations/20260925120100_enforce_nurse_column_restrictions.sql)
// so it also holds for a write that reaches `patients` some other way —
// see supabase/migrations/20260920100200_enable_rls.sql for why RLS's own
// row-level policies can't express a column-level restriction by themselves.

export async function addPatient(input: CreatePatientInput): Promise<string> {
  await requireRole('coordinator', 'admin')
  const parsed = CreatePatientInputSchema.parse(input)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('patients')
    .insert({
      name: parsed.name,
      note: parsed.note ?? null,
      planned_operation: parsed.plannedOperation ?? null,
      planned_check_in: parsed.plannedCheckIn ?? null,
      planned_check_out: parsed.plannedCheckOut ?? null,
      location_room: parsed.location?.room ?? null,
      location_bed: parsed.location?.bed ?? null,
      personal_number: parsed.personalNumber ?? null,
      care_level_medicine: parsed.careLevel?.medicine ?? null,
      care_level_nursing: parsed.careLevel?.nursing ?? null,
      quick_icons: parsed.quickIcons ?? [],
      protected_identity: parsed.protectedIdentity ?? false,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function setPatientLocation(
  patientId: string,
  location: PatientLocation | null,
): Promise<void> {
  await requireRole('nurse', 'coordinator', 'admin')
  const supabase = await createClient()
  const { error } = await supabase
    .from('patients')
    .update({
      location_room: location?.room ?? null,
      location_bed: location?.bed ?? null,
    })
    .eq('id', patientId)
  if (error) throw error
}

export async function editPatient(
  patientId: string,
  input: UpdatePatientInput,
): Promise<void> {
  const user = await requireRole('nurse', 'coordinator', 'admin')
  const parsed = UpdatePatientInputSchema.parse(input)
  const supabase = await createClient()

  if (user.role === 'nurse') {
    // The edit form always submits every field (not just the ones the
    // nurse touched), so we can't reject based on which keys are present —
    // almost every save would include e.g. `name` unchanged. Instead, fetch
    // the current *raw* row (not the masked Patient shape from
    // mapPatientRow — a protected patient's masked "XXXX" must never be
    // compared against, or written back as, the real name) and only reject
    // if a restricted field's value would actually change.
    const { data: currentRow, error: fetchError } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .single()
    if (fetchError) throw fetchError

    const restrictedChanges = [
      parsed.name !== undefined && parsed.name !== currentRow.name,
      parsed.note !== undefined && parsed.note !== currentRow.note,
      parsed.plannedOperation !== undefined && parsed.plannedOperation !== currentRow.planned_operation,
      parsed.plannedCheckIn !== undefined && parsed.plannedCheckIn !== currentRow.planned_check_in,
      parsed.plannedCheckOut !== undefined && parsed.plannedCheckOut !== currentRow.planned_check_out,
      parsed.personalNumber !== undefined && parsed.personalNumber !== currentRow.personal_number,
      parsed.protectedIdentity !== undefined && parsed.protectedIdentity !== currentRow.protected_identity,
    ]
    if (restrictedChanges.some(Boolean)) {
      throw new Error('Forbidden: nurse can only edit location, care level and flags')
    }
  }

  const update: TablesUpdate<'patients'> = {}

  if (parsed.name !== undefined) update.name = parsed.name
  if (parsed.note !== undefined) update.note = parsed.note
  if (parsed.plannedOperation !== undefined) update.planned_operation = parsed.plannedOperation
  if (parsed.plannedCheckIn !== undefined) update.planned_check_in = parsed.plannedCheckIn
  if (parsed.plannedCheckOut !== undefined) update.planned_check_out = parsed.plannedCheckOut
  if (parsed.location !== undefined) {
    update.location_room = parsed.location?.room ?? null
    update.location_bed = parsed.location?.bed ?? null
  }
  if (parsed.personalNumber !== undefined) update.personal_number = parsed.personalNumber
  if (parsed.careLevel !== undefined) {
    update.care_level_medicine = parsed.careLevel?.medicine ?? null
    update.care_level_nursing = parsed.careLevel?.nursing ?? null
  }
  if (parsed.quickIcons !== undefined) update.quick_icons = parsed.quickIcons
  if (parsed.protectedIdentity !== undefined) update.protected_identity = parsed.protectedIdentity

  if (Object.keys(update).length === 0) return

  const { error } = await supabase.from('patients').update(update).eq('id', patientId)
  if (error) throw error
}

export async function deletePatient(patientId: string): Promise<void> {
  await requireRole('coordinator', 'admin')
  const supabase = await createClient()
  const { error } = await supabase.from('patients').delete().eq('id', patientId)
  if (error) throw error
}
