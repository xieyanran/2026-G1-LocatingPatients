import 'server-only'
import { createClient } from './server'
import { requireRole } from '@/lib/auth/session'
import type { BoardData } from '@/lib/data/planning/types'

const EPOCH = '1970-01-01T00:00:00.000Z'

export async function saveBoardData(data: BoardData): Promise<void> {
  await requireRole('nurse', 'coordinator', 'admin')
  const supabase = await createClient()

  // Clear all planning tables, then re-insert current state.
  await Promise.all([
    supabase.from('board_beds').delete().gte('created_at', EPOCH),
    supabase.from('board_plans').delete().gte('created_at', EPOCH),
    supabase.from('bed_events').delete().gte('created_at', EPOCH),
    supabase.from('patient_list_entries').delete().gte('created_at', EPOCH),
  ])

  const allEntries = [
    ...data.permissions.map((p) => ({
      id: p.id,
      collection: 'permissions',
      patient_id: p.patientId,
      from_time: p.from,
      to_time: p.to,
    })),
    ...(data.ivaPatients ?? []).map((p) => ({
      id: p.id,
      collection: 'ivaPatients',
      patient_id: p.patientId,
      from_time: p.from,
      to_time: p.to,
    })),
    ...(data.nivaPatients ?? []).map((p) => ({
      id: p.id,
      collection: 'nivaPatients',
      patient_id: p.patientId,
      from_time: p.from,
      to_time: p.to,
    })),
  ]

  await Promise.all([
    data.beds.length > 0
      ? supabase.from('board_beds').insert(data.beds.map((bed, sort_order) => ({ bed, sort_order })))
      : null,
    data.plan.length > 0
      ? supabase.from('board_plans').insert(data.plan.map((p) => ({ id: p.id, time: p.time, text: p.text })))
      : null,
    data.events.length > 0
      ? supabase.from('bed_events').insert(
          data.events.map((e) => ({
            id: e.id,
            bed: e.bed,
            patient_id: e.patientId,
            start_time: e.start,
            end_time: e.end,
          })),
        )
      : null,
    allEntries.length > 0
      ? supabase.from('patient_list_entries').insert(allEntries)
      : null,
  ])
}
