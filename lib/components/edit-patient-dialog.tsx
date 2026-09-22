"use client"

import { useTransition, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Slot } from "radix-ui"
import { Button } from "@/lib/base-ui/button"
import type { Patient } from "@/lib/data/patients"
import { editPatient } from "@/lib/actions/patients"
import { parseLocation, locationToValue } from "@/lib/utils"
import {
  PatientFormFields,
  PatientFormSchema,
  type PatientFormValues,
} from "./patient-form-fields"
import { FloatingPanelFooter, useFloatingPanel } from "./floating-panel"

const FORM_ID = "edit-patient-form"

function patientToValues(patient: Patient): PatientFormValues {
  return {
    name: patient.name,
    personalNumber: patient.personalNumber ?? "",
    note: patient.note ?? "",
    plannedCheckIn: patient.plannedCheckIn ?? "",
    plannedCheckOut: patient.plannedCheckOut ?? "",
    location: locationToValue(patient.location) ?? "",
    careLevelMedicine: patient.careLevel?.medicine,
    careLevelNursing: patient.careLevel?.nursing
      ? (String(patient.careLevel.nursing) as "1" | "2" | "3")
      : undefined,
    quickIcons: patient.quickIcons,
    protectedIdentity: patient.protectedIdentity,
  }
}

// ── Form content (rendered inside the floating panel) ─────────────────────────

function EditPatientForm({
  patient,
  occupiedBeds,
  disablePersonalNumber,
}: {
  patient: Patient
  occupiedBeds: Set<string>
  disablePersonalNumber?: boolean
}) {
  const { close } = useFloatingPanel()
  const [, startTransition] = useTransition()

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(PatientFormSchema),
    defaultValues: patientToValues(patient),
    mode: "onTouched",
  })

  function onSubmit(values: PatientFormValues) {
    startTransition(async () => {
      await editPatient(patient.id, {
        // A patient already protected when the dialog opened has "XXXX" as
        // `values.name` (see patientToValues) — never send it back as a
        // real name update. Renaming a protected patient isn't supported.
        name: patient.protectedIdentity ? undefined : values.name,
        personalNumber: values.personalNumber || null,
        note: values.note || null,
        plannedCheckIn: values.plannedCheckIn || null,
        plannedCheckOut: values.plannedCheckOut || null,
        location: values.location ? parseLocation(values.location) : null,
        careLevel:
          values.careLevelMedicine && values.careLevelNursing
            ? {
                medicine: values.careLevelMedicine,
                nursing: parseInt(values.careLevelNursing),
              }
            : null,
        quickIcons: values.quickIcons ?? [],
        protectedIdentity: values.protectedIdentity ?? false,
      })
      close()
    })
  }

  function handleCancel() {
    close()
  }

  return (
    <>
      <PatientFormFields
        form={form}
        onSubmit={onSubmit}
        occupiedBeds={occupiedBeds}
        formId={FORM_ID}
        idPrefix="ep"
        disablePersonalNumber={disablePersonalNumber}
        nameLocked={patient.protectedIdentity}
      />
      <FloatingPanelFooter>
        <Button variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID}>
          Save changes
        </Button>
      </FloatingPanelFooter>
    </>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

interface EditPatientDialogProps {
  trigger: ReactNode
  patient: Patient
  occupiedBeds: Set<string>
  onClose?: () => void
  disablePersonalNumber?: boolean
}

export function EditPatientDialog({
  trigger,
  patient,
  occupiedBeds,
  onClose,
  disablePersonalNumber,
}: EditPatientDialogProps) {
  const { open } = useFloatingPanel()

  function handleOpen() {
    open({
      title: patient.name,
      content: (
        <EditPatientForm
          patient={patient}
          occupiedBeds={occupiedBeds}
          disablePersonalNumber={disablePersonalNumber}
        />
      ),
      onClose,
    })
  }

  return <Slot.Root onClick={handleOpen}>{trigger}</Slot.Root>
}
