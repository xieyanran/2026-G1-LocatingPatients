"use client"

import {
  useState,
  useTransition,
  useRef,
  useEffect,
  useMemo,
  startTransition,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { mapPatientRow } from "@/lib/supabase/patients"
import type { Tables } from "@/lib/supabase/types"
import { IconUsers } from "@tabler/icons-react"
import { type Patient, type PatientLocation } from "@/lib/data/patients"
import { locations } from "@/lib/constants/locations"
import { cn } from "@/lib/utils"
import { CareLevelBadge } from "./care-level-badge"
import { CareLevelPicker } from "./care-level-picker"
import { quickIconDefs } from "@/lib/constants/quick-icons"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/lib/base-ui/empty"
import { useRoundSearch } from "./round-controls"
import { editPatient, setPatientLocation } from "@/lib/actions/patients"
import { EditPatientDialog } from "./edit-patient-dialog"
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

const SHOWN_ROOM_IDS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "10",
  "11",
  "Op",
] as const

const allBeds = locations
  .filter((loc) => (SHOWN_ROOM_IDS as readonly string[]).includes(loc.id))
  .flatMap((loc) =>
    Array.from({ length: loc.beds }, (_, i) => ({
      room: loc.id,
      bed: i + 1,
      key: `${loc.id}:${i + 1}`,
    })),
  )

type EditField = "name" | "birthYear" | "nursing" | "plannedOperation" | "note"
type EditingCell = { patientId: string; field: EditField; draft: string }

// ── Drag types & helpers ──────────────────────────────────────────────────────

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

function PatientDragGhost({
  patient,
  width,
}: {
  patient: Patient
  width: number | null
}) {
  const birthYear = patient.personalNumber?.substring(0, 4) ?? null

  return (
    <div
      className="flex items-center h-9 bg-card shadow-xl ring-1 ring-foreground/15 select-none text-sm overflow-hidden opacity-95"
      style={{ width: width ?? "auto" }}
    >
      {/* Name + quick icons — flex-1 */}
      <div className="flex-1 pl-1 pr-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
        <span className="truncate font-medium">{patient.name}</span>
        {patient.quickIcons.length > 0 && (
          <span className="ml-auto shrink-0 flex items-center gap-1">
            {patient.quickIcons.map((id) => {
              const def = quickIconDefs.find((icon) => icon.id === id)
              if (!def) return null
              const Icon = def.icon
              return (
                <span
                  key={id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded p-1 text-xs font-medium",
                    def.bgClass,
                    def.textClass,
                  )}
                >
                  <Icon size={11} strokeWidth={2.5} />
                </span>
              )
            })}
          </span>
        )}
      </div>
      {/* Birth year — w-11 */}
      <div className="w-11 shrink-0 px-1 text-muted-foreground tabular-nums text-xs">
        {birthYear}
      </div>
      {/* Nursing — w-14 */}
      <div className="w-14 shrink-0 px-1">
        {patient.careLevel && (
          <CareLevelBadge
            medicine={patient.careLevel.medicine}
            nursing={patient.careLevel.nursing}
          />
        )}
      </div>
      {/* Planned operation — flex-1 */}
      <div className="flex-1 px-3 text-muted-foreground truncate min-w-0">
        {patient.plannedOperation}
      </div>
      {/* Note — flex-1 */}
      <div className="flex-1 px-3 text-muted-foreground truncate min-w-0">
        {patient.note}
      </div>
    </div>
  )
}

// ── Care level popover ────────────────────────────────────────────────────────

function CareLevelPopover({ patient }: { patient: Patient }) {
  const [open, setOpen] = useState(false)
  const [, startTr] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  if (!patient.careLevel) return null

  function save(medicine: string, nursing: string) {
    if (!medicine || !nursing) return
    startTr(async () => {
      await editPatient(patient.id, {
        careLevel: {
          medicine: medicine as "A" | "B" | "C",
          nursing: parseInt(nursing) as 1 | 2 | 3,
        },
      })
    })
  }

  return (
    <div ref={ref} className="relative inline-block">
      <span className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CareLevelBadge
          medicine={patient.careLevel.medicine}
          nursing={patient.careLevel.nursing}
        />
      </span>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 rounded-lg border border-border bg-popover p-3 shadow-md flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Care level</span>
          <CareLevelPicker
            medicine={patient.careLevel.medicine}
            nursing={String(patient.careLevel.nursing)}
            onMedicineChange={(val) =>
              save(val, String(patient.careLevel!.nursing))
            }
            onNursingChange={(val) =>
              save(patient.careLevel!.medicine, val)
            }
          />
        </div>
      )}
    </div>
  )
}

// ── Swap confirm ──────────────────────────────────────────────────────────────

function SwapConfirmContent({
  patientA,
  patientB,
  fromBedKey,
  toBedKey,
}: {
  patientA: Patient
  patientB: Patient
  fromBedKey: string
  toBedKey: string
}) {
  const { close } = useFloatingPanel()

  function confirm() {
    startTransition(() => {
      setPatientLocation(patientA.id, parseBedKey(toBedKey))
      setPatientLocation(patientB.id, parseBedKey(fromBedKey))
    })
    close()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Swap{" "}
        <strong className="text-foreground font-medium">{patientA.name}</strong>{" "}
        and{" "}
        <strong className="text-foreground font-medium">{patientB.name}</strong>
        ?
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

// ── Inline input ──────────────────────────────────────────────────────────────

interface PatientListProps {
  patients: Patient[]
}

function useCommit(
  editingCell: EditingCell | null,
  setEditingCell: (v: EditingCell | null) => void,
  patients: Patient[],
) {
  const [, startTr] = useTransition()

  return function commit() {
    if (!editingCell) return
    const { patientId, field, draft } = editingCell
    setEditingCell(null)

    const patient = patients.find((p) => p.id === patientId)
    if (!patient) return

    startTr(async () => {
      if (field === "name") {
        const name = draft.trim()
        if (name && name !== patient.name)
          await editPatient(patientId, { name })
      } else if (field === "birthYear") {
        if (/^\d{4}$/.test(draft)) {
          const rest = (patient.personalNumber ?? "").slice(4)
          const next = draft + rest
          if (next !== patient.personalNumber)
            await editPatient(patientId, { personalNumber: next })
        }
      } else if (field === "nursing") {
        const nursing = parseInt(draft)
        if (nursing >= 1 && nursing <= 3 && patient.careLevel) {
          if (nursing !== patient.careLevel.nursing)
            await editPatient(patientId, {
              careLevel: {
                ...patient.careLevel,
                nursing: nursing as 1 | 2 | 3,
              },
            })
        }
      } else if (field === "plannedOperation") {
        const plannedOperation = draft.trim() || null
        if (plannedOperation !== patient.plannedOperation)
          await editPatient(patientId, { plannedOperation })
      } else if (field === "note") {
        const note = draft.trim() || null
        if (note !== patient.note) await editPatient(patientId, { note })
      }
    })
  }
}

function InlineInput({
  value,
  onCommit,
  onCancel,
  onChange,
  className,
}: {
  value: string
  onCommit: () => void
  onCancel: () => void
  onChange: (v: string) => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          onCommit()
        }
        if (e.key === "Escape") {
          e.preventDefault()
          onCancel()
        }
      }}
      className={cn(
        "w-full bg-transparent outline-none ring-0 border-0 p-0 m-0 font-[inherit] text-inherit leading-[inherit]",
        className,
      )}
    />
  )
}

// ── Row components ────────────────────────────────────────────────────────────

function EmptyRow({ bedKey }: { bedKey: string }) {
  const { ref, isDropTarget } = useDroppable({ id: bedKey })
  return (
    <tr
      ref={ref as (el: HTMLTableRowElement | null) => void}
      className={cn(
        "h-9 transition-all",
        isDropTarget && "ring-1 ring-inset ring-primary/50",
      )}
      style={
        isDropTarget
          ? {
              backgroundColor:
                "color-mix(in oklch, var(--primary) 14%, transparent)",
            }
          : undefined
      }
    >
      <td className="whitespace-nowrap pl-3 pr-2 py-0 text-muted-foreground tabular-nums">
        {bedKey}
      </td>
      <td colSpan={5} />
    </tr>
  )
}

function PatientRow({
  bed,
  patient,
  editingCell,
  setEditingCell,
  commit,
  cancel,
  occupiedBeds,
}: {
  bed: { room: string; bed: number; key: string }
  patient: Patient
  editingCell: EditingCell | null
  setEditingCell: (v: EditingCell | null) => void
  commit: () => void
  cancel: () => void
  occupiedBeds: Set<string>
}) {
  const { ref: dropRef, isDropTarget } = useDroppable({ id: bed.key })
  const { ref: dragRef, isDragging } = useDraggable({
    id: `list:${bed.key}`,
    data: { patient, fromBedKey: bed.key } as BedDragData,
  })

  const birthYear = patient.personalNumber
    ? patient.personalNumber.substring(0, 4)
    : null

  const isEditing = (field: EditField) =>
    editingCell?.patientId === patient.id && editingCell?.field === field

  function startEdit(field: EditField, initial: string) {
    setEditingCell({ patientId: patient.id, field, draft: initial })
  }

  return (
    <tr
      ref={(el: HTMLTableRowElement | null) => {
        dropRef(el as Element | null)
        dragRef(el as Element | null)
      }}
      className={cn(
        "group h-9 cursor-grab active:cursor-grabbing transition-all",
        isDropTarget ? "ring-1 ring-inset ring-primary/50" : "hover:shadow-sm",
        isDragging && "opacity-0",
      )}
      style={
        isDropTarget
          ? {
              backgroundColor:
                "color-mix(in oklch, var(--primary) 14%, transparent)",
            }
          : undefined
      }
    >
      {/* Room:Bed — stays flat, not part of the draggable card */}
      <td className="whitespace-nowrap pl-3 pr-0 py-0 text-muted-foreground tabular-nums">
        {bed.key}
      </td>

      {/* Name */}
      <td className="pl-3 pr-2 py-0 group-hover:bg-card transition-colors">
        <div className="flex min-w-0 items-center gap-1.5">
          <EditPatientDialog
            patient={patient}
            occupiedBeds={occupiedBeds}
            trigger={
              <button className="truncate font-medium text-left cursor-pointer hover:underline hover:text-primary">
                {patient.name}
              </button>
            }
          />
          {patient.quickIcons.length > 0 && (
            <span className="ml-auto shrink-0 flex items-center gap-1">
              {patient.quickIcons.map((id) => {
                const def = quickIconDefs.find((icon) => icon.id === id)
                if (!def) return null
                const Icon = def.icon
                return (
                  <span
                    key={id}
                    className={cn(
                      "inline-flex items-center gap-1 rounded p-1 text-xs font-medium",
                      def.bgClass,
                      def.textClass,
                    )}
                  >
                    <Icon size={11} strokeWidth={2.5} />
                  </span>
                )
              })}
            </span>
          )}
        </div>
      </td>

      {/* Birth year */}
      <td
        className={cn(
          "px-1 py-0 text-muted-foreground tabular-nums text-xs group-hover:bg-card transition-colors",
        )}
      >
        {birthYear}
      </td>

      {/* Nursing heaviness */}
      <td className="px-1 py-0 group-hover:bg-card transition-colors">
        <CareLevelPopover patient={patient} />
      </td>

      {/* Planned operation */}
      <td
        className={cn(
          "truncate px-3 py-0 text-muted-foreground cursor-text group-hover:bg-card transition-colors",
          isEditing("plannedOperation") && "ring-1 ring-inset ring-ring",
        )}
        onClick={() =>
          !isEditing("plannedOperation") &&
          startEdit("plannedOperation", patient.plannedOperation ?? "")
        }
      >
        {isEditing("plannedOperation") ? (
          <InlineInput
            value={editingCell!.draft}
            onChange={(v) => setEditingCell({ ...editingCell!, draft: v })}
            onCommit={commit}
            onCancel={cancel}
            className="text-muted-foreground"
          />
        ) : (
          (patient.plannedOperation ?? null)
        )}
      </td>

      {/* Note */}
      <td
        className={cn(
          "truncate px-3 py-0 text-muted-foreground cursor-text group-hover:bg-card transition-colors",
          isEditing("note") && "ring-1 ring-inset ring-ring",
        )}
        onClick={() =>
          !isEditing("note") && startEdit("note", patient.note ?? "")
        }
      >
        {isEditing("note") ? (
          <InlineInput
            value={editingCell!.draft}
            onChange={(v) => setEditingCell({ ...editingCell!, draft: v })}
            onCommit={commit}
            onCancel={cancel}
            className="text-muted-foreground"
          />
        ) : (
          (patient.note ?? null)
        )}
      </td>
    </tr>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function PatientList({ patients: initialPatients }: PatientListProps) {
  "use no memo"
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

  const [localFilter] = useState("")
  const roundCtx = useRoundSearch()
  const query = roundCtx ? roundCtx.query : localFilter

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const commit = useCommit(editingCell, setEditingCell, patients)
  const cancel = () => setEditingCell(null)

  const { open: openPanel } = useFloatingPanel()
  const [activeDragPatient, setActiveDragPatient] = useState<Patient | null>(
    null,
  )
  const [dragRowWidth, setDragRowWidth] = useState<number | null>(null)

  const occupiedBeds = useMemo(
    () =>
      new Set(
        patients
          .filter((p) => p.location)
          .map((p) => `${p.location!.room}:${p.location!.bed}`),
      ),
    [patients],
  )

  const patientByBed = useMemo(
    () =>
      new Map(
        patients
          .filter((p) => p.location)
          .map((p) => [`${p.location!.room}:${p.location!.bed}`, p]),
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

  const displayBeds = query
    ? allBeds.filter((b) => {
        const p = patientByBed.get(b.key)
        if (!p) return false
        const q = query.toLowerCase()
        return (
          p.name.toLowerCase().includes(q) || b.key.toLowerCase().includes(q)
        )
      })
    : allBeds

  const half = Math.ceil(displayBeds.length / 2)
  const chunks = [displayBeds.slice(0, half), displayBeds.slice(half)]

  function handleDragStart(event: {
    operation: { source?: { data?: unknown; element?: Element } }
  }) {
    const data = event.operation.source?.data as BedDragData | undefined
    setActiveDragPatient(data?.patient ?? null)
    const el = event.operation.source?.element as HTMLTableRowElement | null
    if (el) {
      const total = el.getBoundingClientRect().width
      const firstCell = el.querySelector("td")
      const bedColWidth = firstCell?.getBoundingClientRect().width ?? 0
      setDragRowWidth(total - bedColWidth)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragPatient(null)
    if (event.canceled) return

    const sourceData = event.operation.source?.data as BedDragData | undefined
    if (!sourceData) return

    const targetId = event.operation.target?.id as string | undefined
    if (!targetId || targetId === sourceData.fromBedKey) return

    const targetPatient = patientByBed.get(targetId) ?? null

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
            fromBedKey={sourceData.fromBedKey}
            toBedKey={targetId}
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
          <PatientDragGhost patient={activeDragPatient} width={dragRowWidth} />
        ) : null}
      </DragOverlay>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
          {displayBeds.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconUsers />
                </EmptyMedia>
                <EmptyTitle>No patients found</EmptyTitle>
                <EmptyDescription>
                  No patients match your search.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2">
              {chunks.map(
                (chunk, chunkIndex) =>
                  chunk.length > 0 && (
                    <div
                      key={chunkIndex}
                      className={cn(
                        "overflow-x-auto border-b",
                        chunkIndex === 0 && "xl:border-r",
                      )}
                    >
                      <table className="w-full table-fixed text-sm">
                        <colgroup>
                          <col className="w-14" />
                          <col />
                          <col className="w-11" />
                          <col className="w-14" />
                          <col />
                          <col />
                        </colgroup>
                        <tbody className="divide-y divide-border">
                          {chunk.map((bed) => {
                            const patient = patientByBed.get(bed.key) ?? null
                            return patient ? (
                              <PatientRow
                                key={bed.key}
                                bed={bed}
                                patient={patient}
                                editingCell={editingCell}
                                setEditingCell={setEditingCell}
                                commit={commit}
                                cancel={cancel}
                                occupiedBeds={occupiedBeds}
                              />
                            ) : (
                              <EmptyRow key={bed.key} bedKey={bed.key} />
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ),
              )}
            </div>
          )}
        </div>
      </div>
    </DragDropProvider>
  )
}
