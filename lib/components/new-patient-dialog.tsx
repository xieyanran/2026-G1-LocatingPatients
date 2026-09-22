"use client"

import { useTransition, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Slot } from "radix-ui"
import { Button } from "@/lib/base-ui/button"
import { addPatient } from "@/lib/actions/patients"
import { parseLocation } from "@/lib/utils"
import {
  PatientFormFields,
  PatientFormSchema,
  patientFormDefaults,
  type PatientFormValues,
} from "./patient-form-fields"
import { FloatingPanelFooter, useFloatingPanel } from "./floating-panel"

const FORM_ID = "floating-new-patient-form"

// ── Form content (rendered inside the floating panel) ─────────────────────────

function NewPatientForm({
  occupiedBeds,
  onAdded,
}: {
  occupiedBeds: Set<string>
  onAdded?: (id: string) => void
}) {
  const { close } = useFloatingPanel()
  const [, startTransition] = useTransition()

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(PatientFormSchema),
    defaultValues: patientFormDefaults,
    mode: "onTouched",
  })

  function onSubmit(values: PatientFormValues) {
    startTransition(async () => {
      const id = await addPatient({
        name: values.name,
        personalNumber: values.personalNumber || undefined,
        note: values.note || undefined,
        plannedCheckIn: values.plannedCheckIn || null,
        plannedCheckOut: values.plannedCheckOut || null,
        location: values.location ? parseLocation(values.location) : undefined,
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
      onAdded?.(id)
    })
  }

  return (
    <>
      <PatientFormFields
        form={form}
        onSubmit={onSubmit}
        occupiedBeds={occupiedBeds}
        formId={FORM_ID}
        idPrefix="fnp"
      />
      <FloatingPanelFooter>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID}>
          Add patient
        </Button>
      </FloatingPanelFooter>
    </>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

interface NewPatientDialogProps {
  trigger: ReactNode
  occupiedBeds: Set<string>
  onAdded?: (id: string) => void
}

export function NewPatientDialog({
  trigger,
  occupiedBeds,
  onAdded,
}: NewPatientDialogProps) {
  const { open } = useFloatingPanel()

  function handleOpen() {
    open({
      title: "New patient",
      content: <NewPatientForm occupiedBeds={occupiedBeds} onAdded={onAdded} />,
    })
  }

  return <Slot.Root onClick={handleOpen}>{trigger}</Slot.Root>
}
