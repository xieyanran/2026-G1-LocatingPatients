import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'
import type { BoardData } from '@/lib/data/planning/types'

export async function fetchBoardData(
  supabase: SupabaseClient<Database>,
): Promise<BoardData> {
  const [bedsRes, plansRes, eventsRes, entriesRes] = await Promise.all([
    supabase.from('board_beds').select('*').order('sort_order'),
    supabase.from('board_plans').select('*'),
    supabase.from('bed_events').select('*'),
    supabase.from('patient_list_entries').select('*'),
  ])

  const entries = entriesRes.data ?? []

  return {
    beds: (bedsRes.data ?? []).map((r) => r.bed),
    plan: (plansRes.data ?? []).map((r) => ({ id: r.id, time: r.time, text: r.text })),
    events: (eventsRes.data ?? []).map((r) => ({
      id: r.id,
      bed: r.bed,
      patientId: r.patient_id,
      start: r.start_time,
      end: r.end_time,
    })),
    permissions: entries
      .filter((r) => r.collection === 'permissions')
      .map((r) => ({ id: r.id, patientId: r.patient_id, from: r.from_time, to: r.to_time })),
    ivaPatients: entries
      .filter((r) => r.collection === 'ivaPatients')
      .map((r) => ({ id: r.id, patientId: r.patient_id, from: r.from_time, to: r.to_time })),
    nivaPatients: entries
      .filter((r) => r.collection === 'nivaPatients')
      .map((r) => ({ id: r.id, patientId: r.patient_id, from: r.from_time, to: r.to_time })),
  }
}
