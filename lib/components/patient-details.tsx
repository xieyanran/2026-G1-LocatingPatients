"use client"

import {
  IconArrowsExchange,
  IconBandage,
  IconInfoCircle,
  IconMapPin,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react"
import type { Patient } from "@/lib/data/patients"
import { Button } from "@/lib/base-ui/button"
import { calculateAge } from "@/lib/utils"
import { InfoItem } from "./patient-card/info-item"
import { EditPatientDialog } from "./edit-patient-dialog"
import { DeletePatientAlert } from "./delete-patient-alert"
import { MoveDialog } from "./move-dialog"
import { CareLevelBadge } from "./care-level-badge"
import { quickIconById } from "@/lib/constants/quick-icons"
import { cn } from "@/lib/utils"

interface PatientDetailsProps {
  patient: Patient
  occupiedBeds: Set<string>
  onDeleted?: () => void
}

export function PatientDetails({
  patient,
  occupiedBeds,
  onDeleted,
}: PatientDetailsProps) {
  const { name, note, location, personalNumber, careLevel, quickIcons } =
    patient
  const age = calculateAge(personalNumber)
  const subtitle = personalNumber
    ? age !== null
      ? `${personalNumber} · ${age} yrs`
      : personalNumber
    : null

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-col gap-2">
        <div>
          <div className="font-heading text-lg font-medium">{name}</div>
          {subtitle && (
            <div className="text-sm text-muted-foreground">{subtitle}</div>
          )}
        </div>
        {quickIcons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quickIcons.map((id) => {
              const def = quickIconById[id]
              if (!def) return null
              const Icon = def.icon
              return (
                <span
                  key={id}
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-md",
                    def.bgClass,
                    def.textClass,
                  )}
                  title={def.label}
                  aria-label={def.label}
                >
                  <Icon size={12} strokeWidth={2.5} />
                </span>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        {location && (
          <InfoItem icon={<IconMapPin />}>
            {location.room}:{location.bed}
          </InfoItem>
        )}
        {careLevel && (
          <InfoItem icon={<IconBandage />}>
            <CareLevelBadge
              medicine={careLevel.medicine}
              nursing={careLevel.nursing}
            />
          </InfoItem>
        )}
        {note && <InfoItem icon={<IconInfoCircle />}>{note}</InfoItem>}
      </div>
      <div className="mt-auto flex flex-col gap-2 pt-4">
        <MoveDialog
          patient={patient}
          occupiedBeds={occupiedBeds}
          trigger={
            <Button variant="outline">
              <IconArrowsExchange data-icon="inline-start" />
              Move
            </Button>
          }
        />
        <EditPatientDialog
          patient={patient}
          occupiedBeds={occupiedBeds}
          trigger={
            <Button variant="outline">
              <IconPencil data-icon="inline-start" />
              Edit
            </Button>
          }
        />
        <DeletePatientAlert
          patientId={patient.id}
          patientName={name}
          onDeleted={onDeleted}
          trigger={
            <Button variant="destructive">
              <IconTrash data-icon="inline-start" />
              Delete
            </Button>
          }
        />
      </div>
    </div>
  )
}
