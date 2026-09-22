"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/lib/base-ui/input-group"
import { NewPatientDialog } from "./new-patient-dialog"
import { Button } from "@/lib/base-ui/button"
import { IconLogout, IconPlus, IconSearch } from "@tabler/icons-react"
import type { Patient } from "@/lib/data/patients"
import { signOut } from "@/lib/actions/auth"

const RoundSearchContext = createContext<{
  query: string
  setQuery: (v: string) => void
} | null>(null)

export function RoundControlsProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")

  return (
    <RoundSearchContext.Provider value={{ query, setQuery }}>
      {children}
    </RoundSearchContext.Provider>
  )
}

export function useRoundSearch() {
  const ctx = useContext(RoundSearchContext)
  return ctx
}

export function HeaderControls({ patients }: { patients: Patient[] }) {
  const pathname = usePathname()
  const ctx = useRoundSearch()
  const occupiedBeds = new Set(
    patients
      .filter((p) => p.location)
      .map((p) => `${p.location!.room}:${p.location!.bed}`),
  )

  const isRound = pathname === "/"

  return (
    <div className="flex items-center gap-3 ml-auto">
      {isRound && (
        <InputGroup className="w-48">
          <InputGroupInput
            value={ctx?.query ?? ""}
            onChange={(e) => ctx?.setQuery(e.target.value)}
            placeholder="Search patients…"
          />
          <InputGroupAddon align="inline-start">
            <IconSearch />
          </InputGroupAddon>
        </InputGroup>
      )}
      <NewPatientDialog
        occupiedBeds={occupiedBeds}
        trigger={
          <Button size="sm" variant="default">
            <IconPlus data-icon="inline-start" />
            New patient
          </Button>
        }
      />
      <Button size="icon-sm" variant="ghost" onClick={() => signOut()} aria-label="Sign out">
        <IconLogout />
      </Button>
    </div>
  )
}

export default HeaderControls
