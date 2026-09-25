import { ViewToggle } from "@/lib/components/view-toggle"
import { createClient } from "@/lib/supabase/server"
import { mapPatientRow } from "@/lib/supabase/patients"
import { getCurrentUser } from "@/lib/auth/session"
import HeaderControls, {
  RoundControlsProvider,
} from "@/lib/components/round-controls"
import { FloatingPanelProvider } from "@/lib/components/floating-panel"
import { BedEventDraftProvider } from "@/lib/components/bed-event-draft"
import { ConnectionStatus } from "@/lib/components/connection-status"
import { CurrentUserRoleProvider } from "@/lib/components/current-user"

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date())

export default async function WardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data } = await supabase.from("patients").select("*")
  const patients = (data ?? []).map(mapPatientRow)
  const user = await getCurrentUser()

  return (
    <CurrentUserRoleProvider role={user?.role ?? null}>
      <BedEventDraftProvider>
        <FloatingPanelProvider>
          <RoundControlsProvider>
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <header className="dark sticky top-0 z-10 flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-4 text-foreground">
                <ConnectionStatus />
                <span className="text-sm font-medium">Neurosurgery · 10/23</span>
                <div className="h-4 w-px bg-border" />
                <ViewToggle />
                <div className="h-4 w-px bg-border" />
                <span
                  className="text-sm text-muted-foreground"
                  suppressHydrationWarning
                >
                  {dateLabel}
                </span>
                <HeaderControls patients={patients} />
              </header>
              {children}
            </div>
          </RoundControlsProvider>
        </FloatingPanelProvider>
      </BedEventDraftProvider>
    </CurrentUserRoleProvider>
  )
}
