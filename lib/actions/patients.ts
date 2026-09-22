'use server'

import * as dal from '@/lib/supabase/patients.server'
import type { CreatePatientInput, UpdatePatientInput, PatientLocation } from '@/lib/data/patients/types'

export async function addPatient(input: CreatePatientInput): Promise<string> {
  return dal.addPatient(input)
}

export async function setPatientLocation(
  patientId: string,
  location: PatientLocation | null,
): Promise<void> {
  return dal.setPatientLocation(patientId, location)
}

export async function editPatient(patientId: string, input: UpdatePatientInput): Promise<void> {
  return dal.editPatient(patientId, input)
}

export async function deletePatient(patientId: string): Promise<void> {
  return dal.deletePatient(patientId)
}
