"use client"

import { useMemo, useState, startTransition, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { mapPatientRow } from "@/lib/supabase/patients"
import type { Tables } from "@/lib/supabase/types"
import { cn, calculateAge } from "@/lib/utils"
import { type Patient, type PatientLocation } from "@/lib/data/patients"
import { locations } from "@/lib/constants/locations"
import { quickIconById } from "@/lib/constants/quick-icons"
import { careLevelColor } from "./care-level-badge"
import { EditPatientDialog } from "./edit-patient-dialog"
import { setPatientLocation, swapPatientLocations } from "@/lib/actions/patients"
import { useFloatingPanel, FloatingPanelFooter } from "./floating-panel"
import { Button } from "@/lib/base-ui/button"
import {
  DragDropProvider,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/react"
import { PointerActivationConstraints } from "@dnd-kit/dom"

type RoomEntry = string | { id: string; bedStart: number; bedEnd: number }
type SectionColumn = RoomEntry[]

const sections: { label: string; columns: SectionColumn[] }[] = [
  {
    label: "Ward",
    columns: [
      ["01", "02", "03", "04", "05"],
      ["06", "07", "08"],
      ["10", "11"],
    ],
  },
  {
    label: "NIVA",
    columns: [["NIV1", "NIV2", "NIV3", "NIV4", "NIV5"]],
  },
  {
    label: "IVA",
    columns: [
      [{ id: "IVA", bedStart: 1, bedEnd: 8 }],
      [{ id: "IVA", bedStart: 9, bedEnd: 16 }],
    ],
  },
  {
    label: "OP",
    columns: [["Op", "UTL"]],
  },
  {
    label: "Other",
    columns: [
      ["EXTR"],
      [{ id: "PERM", bedStart: 1, bedEnd: 8 }],
      [{ id: "PERM", bedStart: 9, bedEnd: 15 }],
    ],
  },
]

interface BedDragData {
  patient: Patient
  fromBedKey: string
}

function parseBedKey(key: string): PatientLocation {
  const colonIdx = key.lastIndexOf(":")
  return {
    room: key.slice(0, colonIdx) as PatientLocation["room"],
    bed: parseInt(key.slice(colonIdx + 1), 10),
  }
}

// ── Drag ghost ────────────────────────────────────────────────────────────────

function PatientDragGhost({ patient }: { patient: Patient }) {
  const age = calculateAge(patient.personalNumber ?? null)
  const hasBadges = patient.careLevel || patient.quickIcons.length > 0
  return (
    <div className="rounded-md bg-card ring-1 ring-foreground/10 shadow-xl px-3 py-2 select-none opacity-95 min-w-40">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-medium leading-tight">{patient.name}</span>
        {age !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">{age} yrs</span>
        )}
      </div>
      {patient.note && (
        <div className="mt-1 text-xs text-muted-foreground leading-snug">
          {patient.note}
        </div>
      )}
      {hasBadges && (
        <div className="mt-2 flex flex-wrap gap-1">
          {patient.careLevel && (
            <span className="inline-flex divide-x divide-background text-xs font-medium font-mono">
              <span
                className={cn(
                  "inline-flex items-center rounded-l px-1.5 py-0.5",
                  careLevelColor(patient.careLevel.medicine, "medicine"),
                )}
              >
                {patient.careLevel.medicine}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-r px-1.5 py-0.5",
                  careLevelColor(patient.careLevel.nursing, "nursing"),
                )}
              >
                {patient.careLevel.nursing}
              </span>
            </span>
          )}
          {patient.quickIcons.map((id) => {
            const def = quickIconById[id]
            if (!def) return null
            const Icon = def.icon
            return (
              <span
                key={id}
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded",
                  def.bgClass,
                  def.textClass,
                )}
                title={def.label}
              >
                <Icon size={10} strokeWidth={2.5} />
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Swap confirm ──────────────────────────────────────────────────────────────

function SwapConfirmContent({
  patientA,
  patientB,
}: {
  patientA: Patient
  patientB: Patient
}) {
  const { close } = useFloatingPanel()

  function confirm() {
    startTransition(() => {
      swapPatientLocations(patientA.id, patientB.id)
    })
    close()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Swap{" "}
        <strong className="text-foreground font-medium">{patientA.name}</strong>{" "}
        and{" "}
        <strong className="text-foreground font-medium">{patientB.name}</strong>?
      </p>
      <FloatingPanelFooter>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button onClick={confirm}>Swap</Button>
      </FloatingPanelFooter>
    </div>
  )
}

// ── Bed rows ──────────────────────────────────────────────────────────────────

function EmptyBedRow({ roomId, bed }: { roomId: string; bed: number }) {
  const bedKey = `${roomId}:${bed}`
  const { ref, isDropTarget } = useDroppable({ id: bedKey })
  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 transition-colors",
        isDropTarget && "bg-primary/10",
      )}
    >
      <span className="w-3 shrink-0 text-xs text-muted-foreground/40 font-mono">
        {bed}
      </span>
    </div>
  )
}

function PatientBedRow({
  roomId,
  bed,
  patient,
  occupiedBeds,
}: {
  roomId: string
  bed: number
  patient: Patient
  occupiedBeds: Set<string>
}) {
  const bedKey = `${roomId}:${bed}`
  const { ref: dropRef, isDropTarget } = useDroppable({ id: bedKey })
  const { ref: dragRef, isDragging } = useDraggable({
    id: `bed:${bedKey}`,
    data: { patient, fromBedKey: bedKey } as BedDragData,
  })

  const age = calculateAge(patient.personalNumber ?? null)
  const hasBadges = patient.careLevel || patient.quickIcons.length > 0

  return (
    <div
      ref={(el: HTMLDivElement | null) => {
        dropRef(el as Element | null)
        dragRef(el as Element | null)
      }}
      className={cn(
        "group flex items-start gap-1.5 px-3 py-2 cursor-grab active:cursor-grabbing transition-colors",
        isDropTarget && "bg-primary/10",
        isDragging && "opacity-0",
      )}
    >
      <span className="w-3 shrink-0 text-xs text-muted-foreground/60 font-mono mt-0.5">
        {bed}
      </span>
      {/* Patient content — hover lifts it into a card; click opens edit */}
      <div className="flex-1 min-w-0 rounded transition-shadow group-hover:shadow-sm group-hover:ring-1 group-hover:ring-border/40">
        <EditPatientDialog
          patient={patient}
          occupiedBeds={occupiedBeds}
          disablePersonalNumber
          trigger={
            <div className="cursor-pointer select-none">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-sm font-medium leading-tight">
                  {patient.name}
                </span>
                {age !== null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {age} yrs
                  </span>
                )}
              </div>
              {patient.note && (
                <div className="mt-1 text-xs text-muted-foreground leading-snug">
                  {patient.note}
                </div>
              )}
              {hasBadges && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {patient.careLevel && (
                    <span className="inline-flex divide-x divide-background text-xs font-medium font-mono">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-l px-1.5 py-0.5",
                          careLevelColor(patient.careLevel.medicine, "medicine"),
                        )}
                      >
                        {patient.careLevel.medicine}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-r px-1.5 py-0.5",
                          careLevelColor(patient.careLevel.nursing, "nursing"),
                        )}
                      >
                        {patient.careLevel.nursing}
                      </span>
                    </span>
                  )}
                  {patient.quickIcons.map((id) => {
                    const def = quickIconById[id]
                    if (!def) return null
                    const Icon = def.icon
                    return (
                      <span
                        key={id}
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded",
                          def.bgClass,
                          def.textClass,
                        )}
                        title={def.label}
                        aria-label={def.label}
                      >
                        <Icon size={10} strokeWidth={2.5} />
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          }
        />
      </div>
    </div>
  )
}

// ── Room card ─────────────────────────────────────────────────────────────────

function RoomCard({
  entry,
  bedMap,
  occupiedBeds,
}: {
  entry: RoomEntry
  bedMap: Map<string, Patient>
  occupiedBeds: Set<string>
}) {
  const roomId = typeof entry === "string" ? entry : entry.id
  const loc = locations.find((l) => l.id === roomId)
  if (!loc) return null

  const bedStart = typeof entry === "string" ? 1 : entry.bedStart
  const bedEnd = typeof entry === "string" ? loc.beds : entry.bedEnd
  const beds = Array.from({ length: bedEnd - bedStart + 1 }, (_, i) => bedStart + i)

  return (
    <div className="rounded-md bg-background overflow-hidden border border-border/60">
      <div className="flex items-center px-2 py-1 border-b bg-accent border-border/60">
        <span className="font-mono text-xs font-semibold tracking-wide">{roomId}</span>
      </div>
      <div className="divide-y divide-border/40">
        {beds.map((bed) => {
          const patient = bedMap.get(`${roomId}:${bed}`)
          return patient ? (
            <PatientBedRow
              key={bed}
              roomId={roomId}
              bed={bed}
              patient={patient}
              occupiedBeds={occupiedBeds}
            />
          ) : (
            <EmptyBedRow key={bed} roomId={roomId} bed={bed} />
          )
        })}
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

interface WardBoardProps {
  patients: Patient[]
}

export function WardBoard({ patients: initialPatients }: WardBoardProps) {
  const [patients, setPatients] = useState(initialPatients)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel("patients-changes", { config: { private: true } })
      .on("broadcast", { event: "*" }, ({ payload }) => {
        const { operation, record, old_record } = payload as {
          operation: "INSERT" | "UPDATE" | "DELETE"
          record: Tables<"patients"> | null
          old_record: Tables<"patients"> | null
        }
        setPatients((current) => {
          if (operation === "INSERT" && record) {
            const p = mapPatientRow(record)
            return [...current, p]
          }
          if (operation === "UPDATE" && record) {
            const p = mapPatientRow(record)
            return current.map((c) => (c.id === p.id ? p : c))
          }
          if (operation === "DELETE" && old_record) {
            return current.filter((c) => c.id !== old_record.id)
          }
          return current
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const { open: openPanel } = useFloatingPanel()
  const [activeDragPatient, setActiveDragPatient] = useState<Patient | null>(null)

  const bedMap = useMemo(() => {
    const map = new Map<string, Patient>()
    for (const p of patients) {
      if (p.location) {
        map.set(`${p.location.room}:${p.location.bed}`, p)
      }
    }
    return map
  }, [patients])

  const occupiedBeds = useMemo(
    () =>
      new Set(
        patients
          .filter((p) => p.location)
          .map((p) => `${p.location!.room}:${p.location!.bed}`),
      ),
    [patients],
  )

  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [
          new PointerActivationConstraints.Distance({ value: 5 }),
        ],
      }),
    ],
    [],
  )

  function handleDragStart(event: { operation: { source?: { data?: unknown } } }) {
    const data = event.operation.source?.data as BedDragData | undefined
    setActiveDragPatient(data?.patient ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragPatient(null)
    if (event.canceled) return

    const sourceData = event.operation.source?.data as BedDragData | undefined
    if (!sourceData) return

    const targetId = event.operation.target?.id as string | undefined
    if (!targetId || targetId === sourceData.fromBedKey) return

    const targetPatient = bedMap.get(targetId)

    if (!targetPatient) {
      startTransition(() =>
        setPatientLocation(sourceData.patient.id, parseBedKey(targetId)),
      )
    } else {
      openPanel({
        title: "Swap beds?",
        content: (
          <SwapConfirmContent
            patientA={sourceData.patient}
            patientB={targetPatient}
          />
        ),
      })
    }
  }

  return (
    <DragDropProvider
      sensors={sensors}
      onDragStart={handleDragStart as never}
      onDragEnd={handleDragEnd}
    >
      <DragOverlay dropAnimation={null}>
        {activeDragPatient ? (
          <PatientDragGhost patient={activeDragPatient} />
        ) : null}
      </DragOverlay>
      <div className="flex flex-1 min-h-0 overflow-auto bg-muted/30">
        <div className="flex w-full gap-2 p-4 items-start">
          {sections.flatMap((section, si) =>
            section.columns.map((column, ci) => (
              <div
                key={`${si}-${ci}`}
                className="flex flex-col gap-2 flex-1 min-w-0"
              >
                {column.map((entry) => {
                  const cardKey =
                    typeof entry === "string"
                      ? entry
                      : `${entry.id}-${entry.bedStart}-${entry.bedEnd}`
                  return (
                    <RoomCard
                      key={cardKey}
                      entry={entry}
                      bedMap={bedMap}
                      occupiedBeds={occupiedBeds}
                    />
                  )
                })}
              </div>
            )),
          )}
        </div>
      </div>
    </DragDropProvider>
  )
}
