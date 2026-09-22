"use client"

import { useForm, Controller, type FieldErrors } from "react-hook-form"
import { z } from "zod"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/lib/base-ui/field"
import { Input } from "@/lib/base-ui/input"
import { Textarea } from "@/lib/base-ui/textarea"
import { IconArrowRight } from "@tabler/icons-react"
import {
  PersonalNumberSchema,
  QuickIconSchema,
} from "@/lib/data/patients/types"
import type { QuickIconId } from "@/lib/constants/quick-icons"
import { BedPicker } from "./bed-picker"
import { CareLevelPicker } from "./care-level-picker"
import { QuickIconsPicker } from "./quick-icons-picker"

export const PatientFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  personalNumber: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true
      return PersonalNumberSchema.safeParse(val).success
    }, "Accepted formats: YYYYMMDD-XXXX, YYMMDD-XXXX"),
  note: z.string().optional(),
  location: z.string().optional(),
  plannedCheckIn: z.string().optional(),
  plannedCheckOut: z.string().optional(),
  careLevelMedicine: z.enum(["A", "B", "C"]).optional(),
  careLevelNursing: z.enum(["1", "2", "3"]).optional(),
  quickIcons: z.array(QuickIconSchema).optional(),
  protectedIdentity: z.boolean().optional(),
})

export type PatientFormValues = z.infer<typeof PatientFormSchema>

export const patientFormDefaults: PatientFormValues = {
  name: "",
  personalNumber: "",
  note: "",
  location: "",
  plannedCheckIn: "",
  plannedCheckOut: "",
  careLevelMedicine: undefined,
  careLevelNursing: undefined,
  quickIcons: [],
  protectedIdentity: false,
}

interface PatientFormFieldsProps {
  form: ReturnType<typeof useForm<PatientFormValues>>
  onSubmit: (values: PatientFormValues) => void
  occupiedBeds: Set<string>
  formId: string
  idPrefix: string
  disablePersonalNumber?: boolean
  /** True when this patient already has protected_identity set — the name
   * shown here is the masked "XXXX" placeholder, not the real value, so the
   * field must stay read-only. (Editing it would save "XXXX" as the real
   * name.) There's no unmask flow: once protected, the name can't be
   * changed through this form again. */
  nameLocked?: boolean
}

export function PatientFormFields({
  form,
  onSubmit,
  occupiedBeds,
  formId,
  idPrefix,
  disablePersonalNumber = false,
  nameLocked = false,
}: PatientFormFieldsProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = form
  const e = errors as FieldErrors<PatientFormValues>

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)}>
      <FieldGroup>
        <div className="flex gap-2">
          <Field data-invalid={!!e.name}>
            <FieldLabel htmlFor={`${idPrefix}-name`}>Name *</FieldLabel>
            {nameLocked ? (
              <span className="text-sm text-muted-foreground">
                {form.watch("name") || "XXXX"} (protected — locked)
              </span>
            ) : (
              <>
                <Input
                  id={`${idPrefix}-name`}
                  aria-invalid={!!e.name}
                  {...register("name")}
                />
                <FieldError errors={[e.name]} />
              </>
            )}
          </Field>

          <Field className="w-50">
            <FieldLabel>Personal number</FieldLabel>
            {disablePersonalNumber ? (
              <span className="text-sm text-muted-foreground">
                {form.watch("personalNumber") || "—"}
              </span>
            ) : (
              <>
                <Input
                  id={`${idPrefix}-pnr`}
                  placeholder="YYYYMMDD-XXXX"
                  aria-invalid={!!e.personalNumber}
                  {...register("personalNumber")}
                />
                <FieldError errors={[e.personalNumber]} />
              </>
            )}
          </Field>
        </div>

        <Field data-invalid={!!e.note}>
          <FieldLabel htmlFor={`${idPrefix}-note`}>Note</FieldLabel>
          <Textarea
            id={`${idPrefix}-note`}
            rows={3}
            aria-invalid={!!e.note}
            {...register("note")}
          />
          <FieldError errors={[e.note]} />
        </Field>

        <Field data-invalid={!!e.location}>
          <FieldLabel htmlFor={`${idPrefix}-location`}>Location</FieldLabel>
          <Controller
            name="location"
            control={control}
            render={({ field }) => (
              <BedPicker
                id={`${idPrefix}-location`}
                occupiedBeds={occupiedBeds}
                value={field.value ?? ""}
                onChange={field.onChange}
                aria-invalid={!!e.location}
              />
            )}
          />
          <FieldError errors={[e.location]} />
        </Field>

        <Field>
          <FieldLabel>Care level</FieldLabel>
          <Controller
            name="careLevelMedicine"
            control={control}
            render={({ field: medicineField }) => (
              <Controller
                name="careLevelNursing"
                control={control}
                render={({ field: nursingField }) => (
                  <CareLevelPicker
                    medicine={medicineField.value ?? ""}
                    nursing={nursingField.value ?? ""}
                    onMedicineChange={(val) =>
                      medicineField.onChange(val || undefined)
                    }
                    onNursingChange={(val) =>
                      nursingField.onChange(val || undefined)
                    }
                  />
                )}
              />
            )}
          />
        </Field>

        <Field>
          <FieldLabel>Flags</FieldLabel>
          <Controller
            name="quickIcons"
            control={control}
            render={({ field }) => (
              <QuickIconsPicker
                value={(field.value ?? []) as QuickIconId[]}
                onChange={field.onChange}
              />
            )}
          />
        </Field>

        <Field orientation="horizontal">
          <input
            id={`${idPrefix}-protected-identity`}
            type="checkbox"
            className="size-4 rounded border-input"
            {...register("protectedIdentity")}
          />
          <FieldLabel htmlFor={`${idPrefix}-protected-identity`}>
            Protected identity (shows as &quot;XXXX&quot; to staff)
          </FieldLabel>
        </Field>

        <Field>
          <FieldLabel>Planned hospital stay</FieldLabel>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Input
              type="date"
              value={form.watch("plannedCheckIn") ?? ""}
              onChange={(e) => form.setValue("plannedCheckIn", e.target.value)}
            />
            <IconArrowRight className="text-muted-foreground" size={14} />
            <Input
              type="date"
              value={form.watch("plannedCheckOut") ?? ""}
              onChange={(e) => form.setValue("plannedCheckOut", e.target.value)}
            />
          </div>
        </Field>
      </FieldGroup>
    </form>
  )
}
