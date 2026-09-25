"use client"

import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  DragDropProvider,
  DragOverlay,
  PointerSensor,
  useDragDropMonitor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/react"
import { PointerActivationConstraints } from "@dnd-kit/dom"
import {
  IconArrowRight,
  IconPencil,
  IconPlus,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/lib/base-ui/button"
import { Field, FieldGroup, FieldLabel } from "@/lib/base-ui/field"
import { Input } from "@/lib/base-ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/lib/base-ui/select"
import { Card, CardContent, CardFooter, CardTitle } from "@/lib/base-ui/card"
import { Empty, EmptyTitle } from "@/lib/base-ui/empty"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/lib/base-ui/alert-dialog"
import { CareLevelBadge } from "@/lib/components/care-level-badge"
import { NewPatientDialog } from "@/lib/components/new-patient-dialog"
import { EditPatientDialog } from "@/lib/components/edit-patient-dialog"
import { BedPicker } from "@/lib/components/bed-picker"
import {
  FloatingPanelFooter,
  useFloatingPanel,
} from "@/lib/components/floating-panel"
import {
  useBedEventDraft,
  type BedEventDraft,
} from "@/lib/components/bed-event-draft"
import { fetchBoardData } from "@/lib/supabase/planning"
import { mapPatientRow } from "@/lib/supabase/patients"
import { editPatient, setPatientLocation } from "@/lib/actions/patients"
import { saveBoardData } from "@/lib/actions/planning"
import { createClient } from "@/lib/supabase/client"
import type { Tables } from "@/lib/supabase/types"
import type {
  BoardData,
  BedEvent,
  PatientListEntry,
} from "@/lib/data/planning/types"
import type { Patient, PatientLocation } from "@/lib/data/patients/types"
import { locations } from "@/lib/constants/locations"
import { quickIconDefs } from "@/lib/constants/quick-icons"
import { cn } from "@/lib/utils"

const WARD_ROOM_IDS = ["01","02","03","04","05","06","07","08","10","11"] as const

const TIMELINE_BEDS: string[] = [
  ...Array.from({length: 5}, (_, i) => `Op:${i + 1}`),
  ...locations
    .filter((l) => (WARD_ROOM_IDS as readonly string[]).includes(l.id))
    .flatMap((l) => Array.from({length: l.beds}, (_, i) => `${l.id}:${i + 1}`)),
]

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── Timeline math ─────────────────────────────────────────────────────────────

const NIGHT_END = 6
const NIGHT_WIDTH = 7
const DAY_WIDTH = 93
const DAY_HOURS = 18

const GRID_TICKS = Array.from(
  { length: 25 },
  (_, i) => `${String(i).padStart(2, "0")}:00`,
)

const MAJOR_TICKS = new Set([
  "00:00",
  "06:00",
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
  "22:00",
  "24:00",
])

function toHours(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h + m / 60
}

function timeToPercent(timeOrHour: string | number): number {
  const hour = typeof timeOrHour === "number" ? timeOrHour : toHours(timeOrHour)
  if (hour <= NIGHT_END) return (hour / NIGHT_END) * NIGHT_WIDTH
  return NIGHT_WIDTH + ((hour - NIGHT_END) / DAY_HOURS) * DAY_WIDTH
}

type VisibleBedEvent = BedEvent

interface DropIndicatorState {
  activeDropTargetId: string | null
  activeSourceList: string | null
  isDragActive: boolean
}

function orderTimelineBeds(beds: string[]): string[] {
  return beds
    .map((bed, index) => ({
      bed,
      index,
      priority: bed.startsWith("Op:") ? 0 : 1,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ bed }) => bed)
}

function isCurrentOrUpcomingListEntry(
  entry: PatientListEntry,
  today: string,
): boolean {
  const to = entry.to || "9999-12-31"
  return today <= to
}

// ── Timeline drag helpers ─────────────────────────────────────────────────────

function percentToHours(pct: number): number {
  if (pct <= NIGHT_WIDTH) return (pct / NIGHT_WIDTH) * NIGHT_END
  return NIGHT_END + ((pct - NIGHT_WIDTH) / DAY_WIDTH) * DAY_HOURS
}

function snapHours(h: number): number {
  return Math.round(h * 2) / 2 // 30-min snap
}

function snapHoursCreate(h: number): number {
  return h <= NIGHT_END ? Math.round(h) : snapHours(h) // 1-h snap in 00-06, 15-min elsewhere
}

function hoursToTimeStr(h: number): string {
  const clamped = Math.max(0, Math.min(24, h))
  const hh = Math.floor(clamped)
  const mm = Math.round((clamped - hh) * 60)
  if (mm >= 60) return `${String(hh + 1).padStart(2, "0")}:00`
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

interface DragPreview {
  event: VisibleBedEvent
  bed: string
  start: string
  end: string
  kind: "move" | "resize-start" | "resize-end"
}

const LABEL_W = 49 // 48px label col + 1px divider
const PATIENT_COL_W = 88 // narrow current-patient card column
const TRACK_OFFSET = LABEL_W + PATIENT_COL_W + 1 // total px from row left to track area
const ROW_H = 22 // matches inline height style

// ── Drag-and-drop helpers ─────────────────────────────────────────────────────

/** Ghost card shown in the DragOverlay while dragging a patient */
function PatientDragGhost({ patient }: { patient: Patient }) {
  return (
    <div className="w-[220px] rounded-xl bg-card ring-1 ring-foreground/10 shadow-xl px-3 py-2 select-none opacity-95">
      <p className="font-medium text-sm truncate">{patient.name}</p>
      {patient.careLevel && (
        <div className="mt-1">
          <CareLevelBadge
            medicine={patient.careLevel.medicine}
            nursing={patient.careLevel.nursing}
            size="sm"
          />
        </div>
      )}
    </div>
  )
}

/** Shows the card ghost unless the pointer is in the timeline track area (pointer-precise, not box-collision). */
function TimelineAwareDragOverlay({ patient }: { patient: Patient }) {
  const { draft } = useBedEventDraft()
  // draft with id="" is set by the patient-drag monitor only when the pointer
  // is actually within the track area — more precise than @dnd-kit box collision.
  if (draft && !draft.id) return null
  return <PatientDragGhost patient={patient} />
}

function DraggablePatientCard({
  patient,
  dateLabel,
  occupiedBeds,
  listId,
}: {
  patient: Patient
  dateLabel?: string
  occupiedBeds: Set<string>
  listId: string
}) {
  const { ref, isDragging } = useDraggable({
    id: `${listId}:${patient.id}`,
    data: { patient, sourceList: listId },
  })

  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      className={cn(isDragging && "opacity-0")}
    >
      <EditPatientDialog
        patient={patient}
        occupiedBeds={occupiedBeds ?? new Set()}
        trigger={
          <div className="cursor-pointer select-none">
            <PatientCard patient={patient} dateLabel={dateLabel} />
          </div>
        }
      />
    </div>
  )
}

/** Drop-target wrapper. Passes isDropTarget + isDragActive to a render-prop child. */
function DroppableSection({
  id,
  children,
  className,
  dropIndicator,
  containsActivePatient,
}: {
  id: string
  children: (state: {
    isDropTarget: boolean
    isDragActive: boolean
  }) => React.ReactNode
  className?: string
  dropIndicator: DropIndicatorState
  containsActivePatient: boolean
}) {
  const { ref } = useDroppable({ id, data: { type: id } })
  const isDropTarget =
    dropIndicator.activeDropTargetId === id &&
    dropIndicator.activeSourceList !== id &&
    !containsActivePatient

  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      className={cn(className, "rounded-xl transition-all duration-150")}
    >
      {children({ isDropTarget, isDragActive: dropIndicator.isDragActive })}
    </div>
  )
}

// ── PatientCard (derived from main patient store) ─────────────────────────────

function PatientCard({
  patient,
  dateLabel,
}: {
  patient: Patient
  dateLabel?: string
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5">
        <div>
          <CardTitle className="text-sm">{patient.name}</CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {patient.location && (
            <div className="text-xs text-muted-foreground">
              {patient.location.room}:{patient.location.bed}
            </div>
          )}
          {patient.careLevel && (
            <CareLevelBadge
              medicine={patient.careLevel.medicine}
              nursing={patient.careLevel.nursing}
              size="sm"
            />
          )}
          {patient.quickIcons.map((id) => {
            const def = quickIconDefs.find((d) => d.id === id)
            if (!def) return null
            const Icon = def.icon
            return (
              <span
                key={id}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                  def.bgClass,
                  def.textClass,
                )}
              >
                <Icon size={11} />
                {def.label}
              </span>
            )
          })}
        </div>
      </CardContent>
      {dateLabel && (
        <CardFooter className="text-xs text-muted-foreground">
          {dateLabel}
        </CardFooter>
      )}
    </Card>
  )
}

// ── Generic patient-list entry card & form (permissions, IVA, NIVA) ──────────

function PatientListEntryCard({
  entry,
  listId,
  patients,
  editTitle,
  onEdit,
  onDelete,
}: {
  entry: PatientListEntry
  listId: string
  patients: Patient[]
  editTitle?: string
  onEdit: (e: PatientListEntry) => void
  onDelete: (id: string) => void
}) {
  const patient = patients.find((pt) => pt.id === entry.patientId)
  const { ref, isDragging } = useDraggable({
    id: `${listId}:${entry.id}`,
    data: {
      patient:
        patient ?? ({ id: entry.patientId, name: entry.patientId } as Patient),
      sourceList: listId,
    },
  })

  const dateLabel =
    entry.from && entry.to
      ? `${entry.from} → ${entry.to}`
      : entry.from
        ? `Starting ${entry.from}`
        : entry.to
          ? `Returning ${entry.to}`
          : undefined

  if (!patient) return null

  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      onClick={() => onEdit(entry)}
      className={cn(
        "relative group/entry cursor-pointer select-none",
        isDragging && "opacity-0",
      )}
    >
      <PatientCard patient={patient} dateLabel={dateLabel} />
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover/entry:opacity-100 transition-opacity">
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(entry.id)
          }}
          title="Delete"
        >
          <IconX />
        </Button>
      </div>
    </div>
  )
}

function PatientListEntryFormContent({
  initial,
  patients,
  occupiedBeds,
  fromLabel = "From",
  toLabel = "To",
  allEntries = [],
  onSave,
  onSaveWithOverwrite,
}: {
  initial: PatientListEntry | null
  patients: Patient[]
  occupiedBeds: Set<string>
  fromLabel?: string
  toLabel?: string
  allEntries?: PatientListEntry[]
  onSave: (e: PatientListEntry) => void
  onSaveWithOverwrite: (
    e: PatientListEntry,
    conflicting: PatientListEntry[],
  ) => void
}) {
  const { close } = useFloatingPanel()
  const [form, setForm] = useState({
    id: initial?.id ?? "",
    patientId: initial?.patientId ?? "",
    from: initial?.from ?? "",
    to: initial?.to ?? "",
  })
  const [conflicting, setConflicting] = useState<PatientListEntry[] | null>(
    null,
  )

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    const a = { from: form.from || "0000-01-01", to: form.to || "9999-12-31" }
    const conflicts = allEntries.filter((e) => {
      if (e.patientId !== form.patientId) return false
      if (e.id && e.id === form.id) return false
      const b = { from: e.from || "0000-01-01", to: e.to || "9999-12-31" }
      return a.from < b.to && a.to > b.from
    })
    if (conflicts.length > 0) {
      setConflicting(conflicts)
      return
    }
    onSave({ ...form })
    close()
  }

  const patientName = patients.find((p) => p.id === form.patientId)?.name
  const selectedPatient = patients.find((p) => p.id === form.patientId)

  return (
    <>
      <div className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>Patient</FieldLabel>
            <Select
              value={form.patientId}
              onValueChange={(v) => update("patientId", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select patient…" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPatient && (
              <div>
                <EditPatientDialog
                  patient={selectedPatient}
                  occupiedBeds={occupiedBeds}
                  trigger={
                    <Button
                      variant="link"
                      className="text-muted-foreground decoration-muted-foreground px-0 -mt-1"
                      size="sm"
                    >
                      Edit patient <IconArrowRight />
                    </Button>
                  }
                />
              </div>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>{fromLabel}</FieldLabel>
              <Input
                type="date"
                value={form.from}
                onChange={(e) => update("from", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>{toLabel}</FieldLabel>
              <Input
                type="date"
                value={form.to}
                onChange={(e) => update("to", e.target.value)}
              />
            </Field>
          </div>
        </FieldGroup>
        <FloatingPanelFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!form.patientId}>
            Save
          </Button>
        </FloatingPanelFooter>
      </div>

      {conflicting && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setConflicting(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Overwrite existing entry?</AlertDialogTitle>
              <AlertDialogDescription>
                {patientName ?? "This patient"} already has an overlapping
                entry. Saving will remove{" "}
                {conflicting.length === 1 ? "it" : "them"}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConflicting(null)}>
                Go back
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onSaveWithOverwrite({ ...form }, conflicting)
                  close()
                }}
              >
                Overwrite
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}

// ── Discharge patient picker ──────────────────────────────────────────────────

function DischargePatientPickerContent({
  patients,
  dischargePatientIds,
  today,
}: {
  patients: Patient[]
  dischargePatientIds: Set<string>
  today: string
}) {
  const { close } = useFloatingPanel()
  const [query, setQuery] = useState("")

  const available = patients
    .filter((p) => !dischargePatientIds.has(p.id))
    .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  function pick(patient: Patient) {
    startTransition(() => editPatient(patient.id, { plannedCheckOut: today }))
    close()
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        placeholder="Search patients…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="flex flex-col -mx-4">
        {available.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No patients found
          </p>
        ) : (
          available.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className="flex flex-col gap-1 px-4 py-2.5 text-left hover:bg-muted transition-colors"
            >
              <span className="text-sm font-medium">{p.name}</span>
              <div className="flex flex-wrap items-center gap-3">
                {p.location && (
                  <span className="text-xs text-muted-foreground">
                    {p.location.room}:{p.location.bed}
                  </span>
                )}
                {p.careLevel && (
                  <CareLevelBadge
                    medicine={p.careLevel.medicine}
                    nursing={p.careLevel.nursing}
                    size="sm"
                  />
                )}
                {p.quickIcons.map((id) => {
                  const def = quickIconDefs.find((d) => d.id === id)
                  if (!def) return null
                  const Icon = def.icon
                  return (
                    <span
                      key={id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                        def.bgClass,
                        def.textClass,
                      )}
                    >
                      <Icon size={11} />
                      {def.label}
                    </span>
                  )
                })}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Bed-slot helpers ──────────────────────────────────────────────────────────

function parseBedKey(key: string): PatientLocation {
  const colonIdx = key.lastIndexOf(":")
  return {
    room: key.slice(0, colonIdx) as PatientLocation["room"],
    bed: parseInt(key.slice(colonIdx + 1), 10),
  }
}

function BedSlotSwapContent({
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
    const fromLoc = parseBedKey(fromBedKey)
    const toLoc = parseBedKey(toBedKey)
    startTransition(() => {
      setPatientLocation(patientA.id, toLoc)
      setPatientLocation(patientB.id, fromLoc)
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

// ── Current bed patient card (inside timeline rows) ───────────────────────────

function CurrentBedPatient({
  patient,
  occupiedBeds,
}: {
  patient: Patient
  occupiedBeds: Set<string>
}) {
  const fromBedKey = patient.location
    ? `${patient.location.room}:${patient.location.bed}`
    : ""
  const { ref, isDragging } = useDraggable({
    id: `bed-current:${patient.id}`,
    data: { patient, sourceList: "bed-current", fromBedKey },
  })

  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      className={cn("w-full h-full", isDragging && "opacity-30")}
      style={{ touchAction: "none" }}
    >
      <EditPatientDialog
        patient={patient}
        occupiedBeds={occupiedBeds}
        trigger={
          <div className="w-full h-full flex items-center px-1.5 cursor-pointer select-none hover:bg-muted/60 transition-colors">
            <span className="text-[10px] font-medium truncate leading-none text-foreground/80">
              {patient.name}
            </span>
          </div>
        }
      />
    </div>
  )
}

function BedSlotCell({
  bedKey,
  currentPatient,
  occupiedBeds,
}: {
  bedKey: string
  currentPatient: Patient | null
  occupiedBeds: Set<string>
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `bed-slot:${bedKey}`,
  })

  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      className={cn(
        "overflow-hidden self-stretch flex items-center w-full transition-colors",
        isDropTarget && "bg-primary/10",
      )}
    >
      {currentPatient ? (
        <CurrentBedPatient patient={currentPatient} occupiedBeds={occupiedBeds} />
      ) : null}
    </div>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────

interface TimelineEditState {
  id: string
  bed: string
  patientId: string
  start: string
  end: string
}

function BedEventFormContent({
  occupiedBeds,
  patients,
  onSave,
  onDelete,
}: {
  occupiedBeds: Set<string>
  patients: Patient[]
  onSave: (e: TimelineEditState) => void
  onDelete?: (id: string) => void
}) {
  const { close } = useFloatingPanel()
  const { draft, setDraft } = useBedEventDraft()

  if (!draft) return null
  const d = draft

  function set(patch: Partial<BedEventDraft>) {
    setDraft({ ...d, ...patch })
  }
  function save() {
    onSave({ ...d })
    close()
  }
  function del() {
    onDelete!(d.id)
    close()
  }

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel>Patient</FieldLabel>
          <Select
            value={d.patientId}
            onValueChange={(v) => set({ patientId: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select patient…" />
            </SelectTrigger>
            <SelectContent>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {d.patientId &&
            (() => {
              const p = patients.find((x) => x.id === d.patientId)
              if (!p) return null
              return (
                <EditPatientDialog
                  patient={p}
                  occupiedBeds={occupiedBeds}
                  trigger={
                    <Button
                      variant="link"
                      className="text-muted-foreground decoration-muted-foreground px-0 -mt-1"
                      size="sm"
                    >
                      Edit patient <IconArrowRight />
                    </Button>
                  }
                />
              )
            })()}
        </Field>
        <Field>
          <FieldLabel>Bed</FieldLabel>
          <BedPicker
            occupiedBeds={occupiedBeds}
            value={d.bed}
            onChange={(v) => set({ bed: v })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>Start</FieldLabel>
            <Input
              type="time"
              value={d.start}
              onChange={(e) => set({ start: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>End</FieldLabel>
            <Input
              type="time"
              value={d.end}
              onChange={(e) => set({ end: e.target.value })}
            />
          </Field>
        </div>
      </FieldGroup>
      <FloatingPanelFooter className={onDelete ? "justify-between" : undefined}>
        {onDelete && (
          <Button variant="destructive" onClick={del}>
            Delete
          </Button>
        )}
        <Button onClick={save} disabled={!d.patientId || !d.start || !d.end}>
          Save
        </Button>
      </FloatingPanelFooter>
    </div>
  )
}

function Timeline({
  beds,
  events,
  occupiedBeds,
  patients,
  saveEvent,
  deleteEvent,
}: {
  beds: string[]
  events: BedEvent[]
  occupiedBeds: Set<string>
  patients: Patient[]
  saveEvent: (e: TimelineEditState) => void
  deleteEvent: (id: string) => void
}) {
  const { open: openPanel } = useFloatingPanel()
  const { draft, setDraft } = useBedEventDraft()
  const timelineBeds = useMemo(() => orderTimelineBeds(beds), [beds])

  // Live preview: update draft on every move when a patient card is over the timeline
  useDragDropMonitor({
    onDragMove(event: DragMoveEvent) {
      const sourceData = event.operation.source?.data as
        | Record<string, unknown>
        | undefined
      const patient = sourceData?.patient as Patient | undefined
      if (!patient) return // only handle patient card drags, not timeline event drags
      const targetId = event.operation.target?.id
      if (targetId !== "timeline-rows") {
        setDraft(null) // moved away from timeline — clear preview
        return
      }
      const targetEl = (event.operation.target as { element?: Element })
        ?.element
      if (!targetEl || !rowsRef.current) return
      const rect = targetEl.getBoundingClientRect()
      const pos = event.operation.position.current
      // Only activate when pointer is in the track area (right of the bed label column)
      const rawPct =
        ((pos.x - rect.left - TRACK_OFFSET) / (rect.width - TRACK_OFFSET)) * 100
      if (rawPct < 0 || pos.y < rect.top || pos.y > rect.bottom) {
        setDraft(null)
        return
      }
      const bidx = Math.max(
        0,
        Math.min(
          timelineBeds.length - 1,
          Math.floor((pos.y - rect.top) / ROW_H),
        ),
      )
      const pct = Math.min(100, rawPct)
      const startH = Math.max(0, Math.min(22.5, snapHours(percentToHours(pct))))
      setDraft({
        id: "",
        bed: timelineBeds[bidx],
        patientId: patient.id,
        start: hoursToTimeStr(startH),
        end: hoursToTimeStr(Math.min(24, startH + 2)),
      })
    },
  })

  const { ref: timelineDropRef, isDropTarget: isTimelineDrop } = useDroppable({
    id: "timeline-rows",
    data: { type: "timeline" },
  })
  const [nowHours, setNowHours] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowHours(d.getHours() + d.getMinutes() / 60)
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const [dragging, setDragging] = useState<DragPreview | null>(null)
  const [creating, setCreating] = useState<{
    bed: string
    start: string
    end: string
  } | null>(null)
  const rowsRef = useRef<HTMLDivElement>(null)

  function openBedEventForm(initial: TimelineEditState) {
    setDraft({ ...initial })
    openPanel({
      title: initial.id ? "Edit bed event" : "Add bed event",
      content: (
        <BedEventFormContent
          occupiedBeds={occupiedBeds}
          patients={patients}
          onSave={saveEvent}
          onDelete={initial.id ? deleteEvent : undefined}
        />
      ),
      onClose: () => setDraft(null),
    })
  }

  function handleDraftPointerDown(
    e: React.PointerEvent,
    kind: "move" | "resize-start" | "resize-end",
  ) {
    if (!draft) return
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const container = rowsRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const trackLeft = rect.left + TRACK_OFFSET
    const trackWidth = rect.width - TRACK_OFFSET

    const startH = toHours(draft.start)
    const endH = toHours(draft.end)
    const grabH = percentToHours(
      Math.max(0, Math.min(100, ((e.clientX - trackLeft) / trackWidth) * 100)),
    )
    const grabOffset = grabH - startH

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.setAttribute(
      "style",
      `cursor:${kind === "move" ? "grabbing" : "ew-resize"};user-select:none`,
    )

    // Track current draft locally to avoid stale closure
    let cur = { ...draft }

    function onMove(me: PointerEvent) {
      const pct = Math.max(
        0,
        Math.min(100, ((me.clientX - trackLeft) / trackWidth) * 100),
      )
      const curH = percentToHours(pct)
      const bidx = Math.max(
        0,
        Math.min(
          timelineBeds.length - 1,
          Math.floor((me.clientY - rect.top) / ROW_H),
        ),
      )
      if (kind === "move") {
        const dur = endH - startH
        const ns = Math.max(0, Math.min(24 - dur, snapHours(curH - grabOffset)))
        cur = {
          ...cur,
          bed: timelineBeds[bidx],
          start: hoursToTimeStr(ns),
          end: hoursToTimeStr(ns + dur),
        }
      } else if (kind === "resize-start") {
        cur = {
          ...cur,
          start: hoursToTimeStr(
            snapHours(Math.max(0, Math.min(endH - 0.25, curH))),
          ),
        }
      } else {
        cur = {
          ...cur,
          end: hoursToTimeStr(
            snapHours(Math.max(startH + 0.25, Math.min(24, curH))),
          ),
        }
      }
      setDraft({ ...cur })
    }

    function onUp() {
      document.body.setAttribute(
        "style",
        `cursor:${prevCursor};user-select:${prevSelect}`,
      )
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      // No save on release — draft stays until panel's Save button is clicked
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const visibleEvents = events

  const grouped = useMemo(() => {
    const g: Record<string, VisibleBedEvent[]> = {}
    for (const e of visibleEvents) {
      if (!g[e.bed]) g[e.bed] = []
      g[e.bed].push(e)
    }
    return g
  }, [visibleEvents])

  function handlePointerDown(
    e: React.PointerEvent,
    ev: VisibleBedEvent,
    kind: DragPreview["kind"],
  ) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const container = rowsRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const trackLeft = rect.left + TRACK_OFFSET
    const trackWidth = rect.width - TRACK_OFFSET

    const evStartH = toHours(ev.start)
    const evEndH = toHours(ev.end)
    const grabH = percentToHours(
      Math.max(0, Math.min(100, ((e.clientX - trackLeft) / trackWidth) * 100)),
    )
    const grabOffset = grabH - evStartH

    let preview: DragPreview = {
      event: ev,
      bed: ev.bed,
      start: ev.start,
      end: ev.end,
      kind,
    }
    let hasMoved = false
    const sx = e.clientX,
      sy = e.clientY

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.setAttribute(
      "style",
      `cursor:${kind === "move" ? "grabbing" : "ew-resize"};user-select:none`,
    )

    function onMove(me: PointerEvent) {
      if (!hasMoved && Math.hypot(me.clientX - sx, me.clientY - sy) < 4) return
      hasMoved = true

      const pct = Math.max(
        0,
        Math.min(100, ((me.clientX - trackLeft) / trackWidth) * 100),
      )
      const curH = percentToHours(pct)
      const bidx = Math.max(
        0,
        Math.min(
          timelineBeds.length - 1,
          Math.floor((me.clientY - rect.top) / ROW_H),
        ),
      )

      if (kind === "move") {
        const dur = evEndH - evStartH
        const ns = Math.max(0, Math.min(24 - dur, snapHours(curH - grabOffset)))
        preview = {
          ...preview,
          bed: timelineBeds[bidx],
          start: hoursToTimeStr(ns),
          end: hoursToTimeStr(ns + dur),
        }
      } else if (kind === "resize-start") {
        preview = {
          ...preview,
          start: hoursToTimeStr(
            snapHours(Math.max(0, Math.min(evEndH - 0.25, curH))),
          ),
        }
      } else {
        preview = {
          ...preview,
          end: hoursToTimeStr(
            snapHours(Math.max(evStartH + 0.25, Math.min(24, curH))),
          ),
        }
      }
      setDragging({ ...preview })
    }

    function onUp() {
      document.body.setAttribute(
        "style",
        `cursor:${prevCursor};user-select:${prevSelect}`,
      )
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      setDragging(null)

      if (hasMoved) {
        saveEvent({
          id: ev.id,
          bed: preview.bed,
          patientId: ev.patientId,
          start: preview.start,
          end: preview.end,
        })
      } else {
        openBedEventForm({
          id: ev.id,
          bed: ev.bed,
          patientId: ev.patientId,
          start: ev.start,
          end: ev.end,
        })
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  function handleTrackPointerDown(e: React.PointerEvent, bed: string) {
    if (e.button !== 0) return
    e.preventDefault()

    const container = rowsRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const trackLeft = rect.left + TRACK_OFFSET
    const trackWidth = rect.width - TRACK_OFFSET

    const clickH = snapHoursCreate(
      percentToHours(
        Math.max(
          0,
          Math.min(100, ((e.clientX - trackLeft) / trackWidth) * 100),
        ),
      ),
    )

    // ── Edit mode: drag to redefine span, click does nothing ─────────────────
    if (draft) {
      const frozenDraft = draft // narrow for closures
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect

      function onMove(me: PointerEvent) {
        const curH = snapHoursCreate(
          percentToHours(
            Math.max(
              0,
              Math.min(100, ((me.clientX - trackLeft) / trackWidth) * 100),
            ),
          ),
        )
        const s = Math.min(clickH, curH)
        const en = Math.max(clickH, curH)
        if (en - s >= 0.25) {
          document.body.setAttribute(
            "style",
            `cursor:crosshair;user-select:none`,
          )
          setDraft({
            id: frozenDraft.id,
            patientId: frozenDraft.patientId,
            bed,
            start: hoursToTimeStr(s),
            end: hoursToTimeStr(en),
          })
        }
      }

      function onUp() {
        document.body.setAttribute(
          "style",
          `cursor:${prevCursor};user-select:${prevSelect}`,
        )
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onUp)
      return
    }

    // ── Normal mode: create a new event ──────────────────────────────────────
    let preview = {
      bed,
      start: hoursToTimeStr(clickH),
      end: hoursToTimeStr(clickH),
    }
    let hasMoved = false

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect

    function onMove(me: PointerEvent) {
      const curH = snapHoursCreate(
        percentToHours(
          Math.max(
            0,
            Math.min(100, ((me.clientX - trackLeft) / trackWidth) * 100),
          ),
        ),
      )
      const s = Math.min(clickH, curH)
      const en = Math.max(clickH, curH)
      if (en - s < 0.25) return
      if (!hasMoved) {
        hasMoved = true
        document.body.setAttribute("style", `cursor:crosshair;user-select:none`)
      }
      preview = { bed, start: hoursToTimeStr(s), end: hoursToTimeStr(en) }
      setCreating({ ...preview })
    }

    function onUp() {
      document.body.setAttribute(
        "style",
        `cursor:${prevCursor};user-select:${prevSelect}`,
      )
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      setCreating(null)
      if (hasMoved) {
        openBedEventForm({
          id: "",
          bed: preview.bed,
          patientId: "",
          start: preview.start,
          end: preview.end,
        })
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const emptyEvent: TimelineEditState = {
    id: "",
    bed: timelineBeds[0] ?? "01:1",
    patientId: "",
    start: "08:00",
    end: "12:00",
  }
  const patientName = (id: string) =>
    patients.find((p) => p.id === id)?.name ?? (id || "–")

  return (
    <section className="bg-card flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-xs font-bold tracking-wide text-muted-foreground">
          TIMELINE PER BED
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openBedEventForm(emptyEvent)}
        >
          <IconPlus data-icon="inline-start" />
          Add bed event
        </Button>
      </div>

      {/* Time axis */}
      <div
        className="grid gap-2 mb-2"
        style={{ gridTemplateColumns: `48px ${PATIENT_COL_W}px minmax(0,1fr)` }}
      >
        <span />
        <span />
        <div className="relative">
          {GRID_TICKS.map((h) => {
            const major = MAJOR_TICKS.has(h)
            return (
              <span
                key={h}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${timeToPercent(h)}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {major && (
                  <span className="text-[9px] font-semibold leading-none text-muted-foreground mt-0.5 whitespace-nowrap">
                    {h.slice(0, 5)}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>

      {/* Bed rows + drag overlay */}
      <div className="relative overflow-hidden">
        <div
          ref={(el) => {
            rowsRef.current = el
            ;(timelineDropRef as (el: Element | null) => void)(el)
          }}
          className={cn(
            "flex flex-col border-t transition-colors",
            isTimelineDrop && "bg-primary/5",
          )}
        >
          {timelineBeds.map((bed, index) => {
            const colonIdx = bed.indexOf(":")
            const bedRoom = colonIdx >= 0 ? bed.slice(0, colonIdx) : bed
            const bedNum = colonIdx >= 0 ? parseInt(bed.slice(colonIdx + 1)) : NaN
            const currentPatient = patients.find(
              (p) =>
                p.location?.room === bedRoom && p.location?.bed === bedNum,
            ) ?? null
            return (
            <div
              key={bed}
              className="relative grid"
              style={{
                gridTemplateColumns: `${LABEL_W - 1}px 1px ${PATIENT_COL_W}px 1px minmax(0,1fr)`,
                height: ROW_H,
              }}
            >
              <span className="text-xs font-bold text-foreground leading-none truncate self-center pl-2">
                {bed}
              </span>
              <div className="bg-border" />
              <BedSlotCell
                bedKey={bed}
                currentPatient={currentPatient}
                occupiedBeds={occupiedBeds}
              />
              <div className="bg-border" />
              <div
                className="relative overflow-hidden bg-background cursor-crosshair"
                style={{ height: ROW_H }}
                onPointerDown={(e) => handleTrackPointerDown(e, bed)}
              >
                {GRID_TICKS.map((h) => (
                  <span
                    key={h}
                    className={cn(
                      "absolute top-0 bottom-0 w-px",
                      MAJOR_TICKS.has(h) ? "bg-border/60" : "bg-border/25",
                    )}
                    style={{ left: `${timeToPercent(h)}%` }}
                  />
                ))}
                {(grouped[bed] ?? []).map((e) => {
                  const isDrafted = draft?.id === e.id && !!e.id
                  const left = timeToPercent(e.start)
                  const width = Math.max(
                    timeToPercent(e.end) - timeToPercent(e.start),
                    0.6,
                  )
                  const isDragged = dragging?.event.id === e.id

                  if (isDrafted) {
                    // Show original position as a faded ghost — same look as during a live drag
                    return (
                      <div
                        key={e.id}
                        className="absolute inset-y-0 mb-px opacity-20 pointer-events-none"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        <div className="absolute inset-0 flex items-center pl-2.5 pr-2 rounded border border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/40 text-[11px] font-medium text-foreground whitespace-nowrap overflow-hidden">
                          {patientName(e.patientId)}
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "absolute inset-y-0 mb-px",
                        isDragged && "opacity-20",
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10"
                        style={{ touchAction: "none" }}
                        onPointerDown={(ev) =>
                          handlePointerDown(ev, e, "resize-start")
                        }
                      />
                      <div
                        className="absolute inset-0 flex items-center pl-2.5 pr-2 rounded border border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/40 text-[11px] font-medium text-foreground whitespace-nowrap overflow-hidden cursor-grab select-none"
                        style={{ touchAction: "none" }}
                        onPointerDown={(ev) => handlePointerDown(ev, e, "move")}
                      >
                        {patientName(e.patientId)}
                      </div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10"
                        style={{ touchAction: "none" }}
                        onPointerDown={(ev) =>
                          handlePointerDown(ev, e, "resize-end")
                        }
                      />
                    </div>
                  )
                })}
                {/* Draft ghost: shown when editing/creating an event in this bed */}
                {draft?.bed === bed &&
                  (() => {
                    const left = timeToPercent(draft.start)
                    const width = Math.max(
                      timeToPercent(draft.end) - timeToPercent(draft.start),
                      0.6,
                    )
                    return (
                      <div
                        className="absolute inset-y-0 mb-px"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10"
                          style={{ touchAction: "none" }}
                          onPointerDown={(ev) =>
                            handleDraftPointerDown(ev, "resize-start")
                          }
                        />
                        <div
                          className="absolute inset-0 flex items-center pl-2.5 pr-2 rounded border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-[11px] font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap overflow-hidden cursor-grab select-none"
                          style={{ touchAction: "none" }}
                          onPointerDown={(ev) =>
                            handleDraftPointerDown(ev, "move")
                          }
                        >
                          {draft.patientId ? patientName(draft.patientId) : "–"}
                        </div>
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10"
                          style={{ touchAction: "none" }}
                          onPointerDown={(ev) =>
                            handleDraftPointerDown(ev, "resize-end")
                          }
                        />
                      </div>
                    )
                  })()}
                {index < timelineBeds.length - 1 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/70" />
                )}
              </div>
            </div>
            )
          })}
        </div>

        {dragging &&
          (() => {
            const bidx = timelineBeds.indexOf(dragging.bed)
            const left = timeToPercent(dragging.start)
            const width = Math.max(
              timeToPercent(dragging.end) - timeToPercent(dragging.start),
              0.6,
            )
            return (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ left: TRACK_OFFSET }}
              >
                <div
                  className="absolute flex items-center px-2 rounded border border-blue-600 bg-blue-500 text-[11px] font-medium text-white whitespace-nowrap overflow-hidden shadow-md"
                  style={{
                    top: bidx * ROW_H + 1,
                    height: ROW_H - 2,
                    left: `${left}%`,
                    width: `${width}%`,
                  }}
                >
                  {patientName(dragging.event.patientId)}
                </div>
              </div>
            )
          })()}
        {creating &&
          (() => {
            const bidx = timelineBeds.indexOf(creating.bed)
            const left = timeToPercent(creating.start)
            const width = Math.max(
              timeToPercent(creating.end) - timeToPercent(creating.start),
              0.6,
            )
            return (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ left: TRACK_OFFSET }}
              >
                <div
                  className="absolute rounded border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-[10px] font-semibold text-blue-600 dark:text-blue-400"
                  style={{
                    top: bidx * ROW_H + 1,
                    height: ROW_H - 2,
                    left: `${left}%`,
                    width: `${width}%`,
                  }}
                >
                  {creating.start}–{creating.end}
                </div>
              </div>
            )
          })()}
        {/* Current time indicator */}
        {nowHours !== null && nowHours >= 0 && nowHours <= 24 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ left: TRACK_OFFSET }}
          >
            <div
              className="absolute inset-y-0 w-px bg-red-500"
              style={{ left: `${timeToPercent(nowHours)}%` }}
            >
              <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-red-500" />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function SectionEmpty({ isDropTarget }: { isDropTarget: boolean }) {
  return (
    <Empty
      className={cn(
        "p-4 mt-1 transition-all duration-150 ease-out origin-top",
        isDropTarget ? "border-sky-400" : "bg-muted/50 border-border/40",
        isDropTarget ? "scale-[1.01] shadow-sm" : "scale-[0.99]",
      )}
      style={
        isDropTarget
          ? {
              backgroundColor:
                "color-mix(in oklch, var(--primary) 14%, transparent)",
              borderColor: "var(--primary)",
            }
          : undefined
      }
    >
      <EmptyTitle
        className={cn(
          "text-xs font-normal transition-colors",
          isDropTarget
            ? "text-sky-700 dark:text-sky-400"
            : "text-muted-foreground",
        )}
      >
        {isDropTarget ? "Release to drop" : "No patients"}
      </EmptyTitle>
    </Empty>
  )
}

function insertionIndex(sortedNames: string[], name: string): number {
  for (let i = 0; i < sortedNames.length; i++) {
    if (name.localeCompare(sortedNames[i]) <= 0) return i
  }
  return sortedNames.length
}

/** Shows a drop zone at the alphabetically correct position in a non-empty section. */
function SectionDropHint({ isDropTarget }: { isDropTarget: boolean }) {
  if (!isDropTarget) return null

  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed border-sky-400 px-4 py-3 flex items-center justify-center overflow-hidden origin-top",
        "motion-safe:animate-[drop-hint-expand_160ms_cubic-bezier(0.16,1,0.3,1)]",
      )}
      style={{
        backgroundColor: "color-mix(in oklch, var(--primary) 14%, transparent)",
        borderColor: "var(--primary)",
      }}
    >
      <span
        className={cn(
          "text-xs transition-colors",
          "text-sky-700 dark:text-sky-400",
        )}
      >
        Release to drop
      </span>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  addTrigger,
}: {
  label: string
  count: number
  addTrigger: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-bold tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold">{count}</span>
        {addTrigger}
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function PlanningBoard({
  initialData,
  patients: initialPatients,
  today,
}: {
  initialData: BoardData
  patients: Patient[]
  today: string
}) {
  const [data, setData] = useState<BoardData>(initialData)
  const [patients, setPatients] = useState(initialPatients)
  const lastSaveAt = useRef(0)
  const boardRealtimeTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  // Live patient updates
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
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Live board data updates — debounced full re-fetch to handle multi-row saves cleanly
  const refetchBoard = useCallback(async () => {
    if (Date.now() - lastSaveAt.current < 600) return
    const supabase = createClient()
    const fresh = await fetchBoardData(supabase)
    setData(fresh)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const BOARD_TABLES = [
      "board_beds",
      "board_plans",
      "bed_events",
      "patient_list_entries",
    ] as const
    const channel = supabase.channel("board-data")
    for (const table of BOARD_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (boardRealtimeTimeout.current)
            clearTimeout(boardRealtimeTimeout.current)
          boardRealtimeTimeout.current = setTimeout(refetchBoard, 250)
        },
      )
    }
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (boardRealtimeTimeout.current)
        clearTimeout(boardRealtimeTimeout.current)
    }
  }, [refetchBoard])

  const { open: openPanel } = useFloatingPanel()
  const { draft, setDraft } = useBedEventDraft()
  const [activePatient, setActivePatient] = useState<Patient | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState>({
    activeDropTargetId: null,
    activeSourceList: null,
    isDragActive: false,
  })

  const arrivals = useMemo(
    () =>
      patients
        .filter((p) => p.plannedCheckIn === today)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [patients, today],
  )
  const discharges = useMemo(
    () =>
      patients
        .filter((p) => p.plannedCheckOut === today)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [patients, today],
  )
  const currentPermissions = useMemo(
    () =>
      (data.permissions ?? [])
        .filter((entry) => isCurrentOrUpcomingListEntry(entry, today))
        .sort((a, b) => {
          const na = patients.find((p) => p.id === a.patientId)?.name ?? ""
          const nb = patients.find((p) => p.id === b.patientId)?.name ?? ""
          return na.localeCompare(nb)
        }),
    [data.permissions, today, patients],
  )
  const currentIvaPatients = useMemo(
    () =>
      (data.ivaPatients ?? [])
        .filter((entry) => isCurrentOrUpcomingListEntry(entry, today))
        .sort((a, b) => {
          const na = patients.find((p) => p.id === a.patientId)?.name ?? ""
          const nb = patients.find((p) => p.id === b.patientId)?.name ?? ""
          return na.localeCompare(nb)
        }),
    [data.ivaPatients, today, patients],
  )
  const currentNivaPatients = useMemo(
    () =>
      (data.nivaPatients ?? [])
        .filter((entry) => isCurrentOrUpcomingListEntry(entry, today))
        .sort((a, b) => {
          const na = patients.find((p) => p.id === a.patientId)?.name ?? ""
          const nb = patients.find((p) => p.id === b.patientId)?.name ?? ""
          return na.localeCompare(nb)
        }),
    [data.nivaPatients, today, patients],
  )
  const arrivalPatientIds = useMemo(
    () => new Set(arrivals.map((p) => p.id)),
    [arrivals],
  )
  const dischargePatientIds = useMemo(
    () => new Set(discharges.map((p) => p.id)),
    [discharges],
  )
  const permissionPatientIds = useMemo(
    () => new Set(currentPermissions.map((entry) => entry.patientId)),
    [currentPermissions],
  )
  const ivaPatientIds = useMemo(
    () => new Set(currentIvaPatients.map((entry) => entry.patientId)),
    [currentIvaPatients],
  )
  const nivaPatientIds = useMemo(
    () => new Set(currentNivaPatients.map((entry) => entry.patientId)),
    [currentNivaPatients],
  )

  function updateData(updater: (current: BoardData) => BoardData) {
    const next = updater(data)
    setData(next)
    lastSaveAt.current = Date.now()
    startTransition(() => {
      saveBoardData(next)
    })
  }

  const occupiedBeds = useMemo(
    () => new Set(data.events.map((e) => e.bed)),
    [data.events],
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

  type EntryCollection = "permissions" | "ivaPatients" | "nivaPatients"

  function allListEntries() {
    return [
      ...(data.permissions ?? []),
      ...(data.ivaPatients ?? []),
      ...(data.nivaPatients ?? []),
    ]
  }

  function openEntryPanel(
    entry: PatientListEntry | null,
    collection: EntryCollection,
    title: string,
    fromLabel: string,
    toLabel: string,
  ) {
    openPanel({
      title: entry?.id ? title.replace("Add", "Edit") : title,
      content: (
        <PatientListEntryFormContent
          initial={entry}
          patients={patients}
          occupiedBeds={occupiedBeds}
          fromLabel={fromLabel}
          toLabel={toLabel}
          allEntries={allListEntries()}
          onSave={(e) => saveEntry(collection, e)}
          onSaveWithOverwrite={(e, conflicting) => {
            updateData((current) => {
              const ids = new Set(conflicting.map((c) => c.id))
              const pruned = {
                ...current,
                permissions: (current.permissions ?? []).filter(
                  (x) => !ids.has(x.id),
                ),
                ivaPatients: (current.ivaPatients ?? []).filter(
                  (x) => !ids.has(x.id),
                ),
                nivaPatients: (current.nivaPatients ?? []).filter(
                  (x) => !ids.has(x.id),
                ),
              }
              const item = { ...e, id: e.id || nextId(collection) }
              const list = pruned[collection] ?? []
              return {
                ...pruned,
                [collection]: [...list.filter((x) => x.id !== item.id), item],
              }
            })
          }}
        />
      ),
    })
  }

  function saveEntry(collection: EntryCollection, entry: PatientListEntry) {
    updateData((current) => {
      const item = { ...entry, id: entry.id || nextId(collection) }
      const list = current[collection] ?? []
      const exists = list.some((e) => e.id === item.id)
      return {
        ...current,
        [collection]: exists
          ? list.map((e) => (e.id === item.id ? item : e))
          : [...list, item],
      }
    })
  }

  function deleteEntry(collection: EntryCollection, id: string) {
    updateData((current) => ({
      ...current,
      [collection]: (current[collection] ?? []).filter((e) => e.id !== id),
    }))
  }

  function saveEvent(item: TimelineEditState) {
    updateData((current) => {
      const event: BedEvent = {
        id: item.id || nextId("event"),
        bed: item.bed,
        patientId: item.patientId,
        start: item.start,
        end: item.end,
      }
      const exists = current.events.some((e) => e.id === event.id)
      return {
        ...current,
        events: exists
          ? current.events.map((e) => (e.id === event.id ? event : e))
          : [...current.events, event],
      }
    })
  }

  function deleteEvent(id: string) {
    updateData((current) => ({
      ...current,
      events: current.events.filter((e) => e.id !== id),
    }))
  }

  function handleDragStart(event: {
    operation: { source?: { data?: unknown } }
  }) {
    const data = event.operation.source?.data as
      | Record<string, unknown>
      | undefined
    setActivePatient((data?.patient as Patient | undefined) ?? null)
    setDropIndicator({
      activeDropTargetId: null,
      activeSourceList: (data?.sourceList as string | undefined) ?? null,
      isDragActive: !!data?.patient,
    })
  }

  function handleDragMove(event: DragMoveEvent) {
    setDropIndicator((current) => ({
      ...current,
      activeDropTargetId:
        (event.operation.target?.id as string | undefined) ?? null,
    }))
  }

  function clearDropIndicator() {
    setDropIndicator({
      activeDropTargetId: null,
      activeSourceList: null,
      isDragActive: false,
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    setActivePatient(null)
    clearDropIndicator()
    const sourceData = event.operation.source?.data as
      | Record<string, unknown>
      | undefined
    const patient = sourceData?.patient as Patient | undefined
    if (!patient || event.canceled) {
      setDraft(null)
      return
    }

    const targetId = event.operation.target?.id
    const sourceList = sourceData?.sourceList as string | undefined

    // No valid target, or dropped back on the source section — nothing to do
    if (!targetId || targetId === sourceList) {
      setDraft(null)
      return
    }

    if (typeof targetId === "string" && targetId.startsWith("bed-slot:")) {
      setDraft(null)
      const toBedKey = targetId.slice("bed-slot:".length)
      const fromBedKey = sourceData?.fromBedKey as string | undefined
      if (fromBedKey && toBedKey === fromBedKey) return
      const toLoc = parseBedKey(toBedKey)
      const targetPatient = patients.find(
        (p) => p.location?.room === toLoc.room && p.location?.bed === toLoc.bed,
      ) ?? null
      if (!targetPatient || !fromBedKey) {
        startTransition(() => setPatientLocation(patient.id, toLoc))
      } else {
        openPanel({
          title: "Swap beds?",
          content: (
            <BedSlotSwapContent
              patientA={patient}
              patientB={targetPatient}
              fromBedKey={fromBedKey}
              toBedKey={toBedKey}
            />
          ),
        })
      }
    } else if (targetId === "timeline-rows" && draft) {
      // Draft is already set to the correct position by the live useDragDropMonitor in Timeline.
      // Just open the panel — no need to re-compute position.
      openPanel({
        title: "Add bed event",
        content: (
          <BedEventFormContent
            occupiedBeds={occupiedBeds}
            patients={patients}
            onSave={saveEvent}
          />
        ),
        onClose: () => setDraft(null),
      })
    } else {
      setDraft(null) // clear timeline preview for non-timeline drops
      if (targetId === "arrivals") {
        startTransition(() =>
          editPatient(patient.id, { plannedCheckIn: today }),
        )
      } else if (targetId === "discharges") {
        startTransition(() =>
          editPatient(patient.id, { plannedCheckOut: today }),
        )
      } else if (targetId === "permissions") {
        openEntryPanel(
          { id: "", patientId: patient.id, from: today, to: "" },
          "permissions",
          "Add permission / leave",
          "Leave from",
          "Expected return",
        )
      } else if (targetId === "ivaPatients") {
        openEntryPanel(
          { id: "", patientId: patient.id, from: today, to: today },
          "ivaPatients",
          "Add to IVA",
          "Admitted",
          "Expected return to ward",
        )
      } else if (targetId === "nivaPatients") {
        openEntryPanel(
          { id: "", patientId: patient.id, from: today, to: today },
          "nivaPatients",
          "Add to NIVA",
          "Admitted",
          "Expected return to ward",
        )
      }
    }
  }

  return (
    <DragDropProvider
      sensors={sensors}
      onDragStart={handleDragStart as never}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <DragOverlay dropAnimation={null}>
        {activePatient ? (
          <TimelineAwareDragOverlay patient={activePatient} />
        ) : null}
      </DragOverlay>
      <div
        className="grid divide-x h-full overflow-y-auto"
        style={{ gridTemplateColumns: "260px minmax(0,1fr) 260px" }}
      >
        <aside className="px-4 py-3 flex flex-col gap-4 overflow-y-auto">
          <DroppableSection
            id="arrivals"
            className="rounded-xl bg-card"
            dropIndicator={dropIndicator}
            containsActivePatient={
              !!activePatient && arrivalPatientIds.has(activePatient.id)
            }
          >
            {({ isDropTarget }) => (
              <>
                <SectionHeader
                  label="TODAY ARRIVALS"
                  count={arrivals.length}
                  addTrigger={
                    <NewPatientDialog
                      occupiedBeds={occupiedBeds}
                      trigger={
                        <Button size="icon-xs" variant="outline">
                          <IconPlus />
                        </Button>
                      }
                    />
                  }
                />
                {arrivals.length === 0 ? (
                  <SectionEmpty isDropTarget={isDropTarget} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const idx =
                        isDropTarget && activePatient
                          ? insertionIndex(
                              arrivals.map((p) => p.name),
                              activePatient.name,
                            )
                          : arrivals.length
                      return (
                        <>
                          {arrivals.slice(0, idx).map((p) => (
                            <DraggablePatientCard
                              key={p.id}
                              patient={p}
                              occupiedBeds={occupiedBeds}
                              listId="arrivals"
                            />
                          ))}
                          <SectionDropHint isDropTarget={isDropTarget} />
                          {arrivals.slice(idx).map((p) => (
                            <DraggablePatientCard
                              key={p.id}
                              patient={p}
                              occupiedBeds={occupiedBeds}
                              listId="arrivals"
                            />
                          ))}
                        </>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </DroppableSection>

          <DroppableSection
            id="ivaPatients"
            dropIndicator={dropIndicator}
            containsActivePatient={
              !!activePatient && ivaPatientIds.has(activePatient.id)
            }
          >
            {({ isDropTarget }) => (
              <>
                <SectionHeader
                  label="IVA"
                  count={currentIvaPatients.length}
                  addTrigger={
                    <Button
                      size="icon-xs"
                      variant="outline"
                      onClick={() =>
                        openEntryPanel(
                          null,
                          "ivaPatients",
                          "Add to IVA",
                          "Admitted",
                          "Expected return to ward",
                        )
                      }
                    >
                      <IconPlus />
                    </Button>
                  }
                />
                {currentIvaPatients.length === 0 ? (
                  <SectionEmpty isDropTarget={isDropTarget} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const idx =
                        isDropTarget && activePatient
                          ? insertionIndex(
                              currentIvaPatients.map(
                                (e) =>
                                  patients.find((p) => p.id === e.patientId)
                                    ?.name ?? "",
                              ),
                              activePatient.name,
                            )
                          : currentIvaPatients.length
                      const renderEntry = (
                        e: (typeof currentIvaPatients)[0],
                      ) => (
                        <PatientListEntryCard
                          key={e.id}
                          entry={e}
                          listId="ivaPatients"
                          patients={patients}
                          editTitle="Edit IVA dates"
                          onEdit={(entry) =>
                            openEntryPanel(
                              entry,
                              "ivaPatients",
                              "Add to IVA",
                              "Admitted",
                              "Expected return to ward",
                            )
                          }
                          onDelete={(id) => deleteEntry("ivaPatients", id)}
                        />
                      )
                      return (
                        <>
                          {currentIvaPatients.slice(0, idx).map(renderEntry)}
                          <SectionDropHint isDropTarget={isDropTarget} />
                          {currentIvaPatients.slice(idx).map(renderEntry)}
                        </>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </DroppableSection>

          <DroppableSection
            id="nivaPatients"
            dropIndicator={dropIndicator}
            containsActivePatient={
              !!activePatient && nivaPatientIds.has(activePatient.id)
            }
          >
            {({ isDropTarget }) => (
              <>
                <SectionHeader
                  label="NIVA"
                  count={currentNivaPatients.length}
                  addTrigger={
                    <Button
                      size="icon-xs"
                      variant="outline"
                      onClick={() =>
                        openEntryPanel(
                          null,
                          "nivaPatients",
                          "Add to NIVA",
                          "Admitted",
                          "Expected return to ward",
                        )
                      }
                    >
                      <IconPlus />
                    </Button>
                  }
                />
                {currentNivaPatients.length === 0 ? (
                  <SectionEmpty isDropTarget={isDropTarget} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const idx =
                        isDropTarget && activePatient
                          ? insertionIndex(
                              currentNivaPatients.map(
                                (e) =>
                                  patients.find((p) => p.id === e.patientId)
                                    ?.name ?? "",
                              ),
                              activePatient.name,
                            )
                          : currentNivaPatients.length
                      const renderEntry = (
                        e: (typeof currentNivaPatients)[0],
                      ) => (
                        <PatientListEntryCard
                          key={e.id}
                          entry={e}
                          listId="nivaPatients"
                          patients={patients}
                          editTitle="Edit NIVA dates"
                          onEdit={(entry) =>
                            openEntryPanel(
                              entry,
                              "nivaPatients",
                              "Add to NIVA",
                              "Admitted",
                              "Expected return to ward",
                            )
                          }
                          onDelete={(id) => deleteEntry("nivaPatients", id)}
                        />
                      )
                      return (
                        <>
                          {currentNivaPatients.slice(0, idx).map(renderEntry)}
                          <SectionDropHint isDropTarget={isDropTarget} />
                          {currentNivaPatients.slice(idx).map(renderEntry)}
                        </>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </DroppableSection>
        </aside>

        <Timeline
          beds={TIMELINE_BEDS}
          events={data.events}
          occupiedBeds={occupiedBeds}
          patients={patients}
          saveEvent={saveEvent}
          deleteEvent={deleteEvent}
        />

        <aside className="rounded-xl bg-card flex flex-col gap-4 px-4 py-3">
          <DroppableSection
            id="discharges"
            dropIndicator={dropIndicator}
            containsActivePatient={
              !!activePatient && dischargePatientIds.has(activePatient.id)
            }
          >
            {({ isDropTarget }) => (
              <>
                <SectionHeader
                  label="TODAY DISCHARGES"
                  count={discharges.length}
                  addTrigger={
                    <Button
                      size="icon-xs"
                      variant="outline"
                      onClick={() =>
                        openPanel({
                          title: "Add to today's discharges",
                          content: (
                            <DischargePatientPickerContent
                              patients={patients}
                              dischargePatientIds={dischargePatientIds}
                              today={today}
                            />
                          ),
                        })
                      }
                    >
                      <IconPlus />
                    </Button>
                  }
                />
                {discharges.length === 0 ? (
                  <SectionEmpty isDropTarget={isDropTarget} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const idx =
                        isDropTarget && activePatient
                          ? insertionIndex(
                              discharges.map((p) => p.name),
                              activePatient.name,
                            )
                          : discharges.length
                      return (
                        <>
                          {discharges.slice(0, idx).map((p) => (
                            <DraggablePatientCard
                              key={p.id}
                              patient={p}
                              occupiedBeds={occupiedBeds}
                              listId="discharges"
                            />
                          ))}
                          <SectionDropHint isDropTarget={isDropTarget} />
                          {discharges.slice(idx).map((p) => (
                            <DraggablePatientCard
                              key={p.id}
                              patient={p}
                              occupiedBeds={occupiedBeds}
                              listId="discharges"
                            />
                          ))}
                        </>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </DroppableSection>

          <DroppableSection
            id="permissions"
            dropIndicator={dropIndicator}
            containsActivePatient={
              !!activePatient && permissionPatientIds.has(activePatient.id)
            }
          >
            {({ isDropTarget }) => (
              <>
                <SectionHeader
                  label="PERMISSION / ON LEAVE"
                  count={currentPermissions.length}
                  addTrigger={
                    <Button
                      size="icon-xs"
                      variant="outline"
                      onClick={() =>
                        openEntryPanel(
                          null,
                          "permissions",
                          "Add permission / leave",
                          "Leave from",
                          "Expected return",
                        )
                      }
                    >
                      <IconPlus />
                    </Button>
                  }
                />
                {currentPermissions.length === 0 ? (
                  <SectionEmpty isDropTarget={isDropTarget} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const idx =
                        isDropTarget && activePatient
                          ? insertionIndex(
                              currentPermissions.map(
                                (e) =>
                                  patients.find((p) => p.id === e.patientId)
                                    ?.name ?? "",
                              ),
                              activePatient.name,
                            )
                          : currentPermissions.length
                      const renderEntry = (
                        e: (typeof currentPermissions)[0],
                      ) => (
                        <PatientListEntryCard
                          key={e.id}
                          entry={e}
                          listId="permissions"
                          patients={patients}
                          editTitle="Edit leave dates"
                          onEdit={(entry) =>
                            openEntryPanel(
                              entry,
                              "permissions",
                              "Add permission / leave",
                              "Leave from",
                              "Expected return",
                            )
                          }
                          onDelete={(id) => deleteEntry("permissions", id)}
                        />
                      )
                      return (
                        <>
                          {currentPermissions.slice(0, idx).map(renderEntry)}
                          <SectionDropHint isDropTarget={isDropTarget} />
                          {currentPermissions.slice(idx).map(renderEntry)}
                        </>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </DroppableSection>
        </aside>
      </div>
    </DragDropProvider>
  )
}
