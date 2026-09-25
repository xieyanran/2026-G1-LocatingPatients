"use client"

import { useEffect } from "react"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/lib/base-ui/empty"
import { Button } from "@/lib/base-ui/button"

/** Safety net for the ward routes: without this, an uncaught error from a
 * bed-move action (e.g. BedOccupiedError from a same-bed race — issue #12)
 * bubbles past `startTransition` and crashes the whole board instead of
 * showing a recoverable message. In production Next.js redacts thrown
 * Server Action error messages, so `error.message` falls back to a generic
 * string rather than assuming the specific reason survived. */
export default function WardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          {error.message || "That action couldn't be completed. Please try again."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => unstable_retry()}>Try again</Button>
      </EmptyContent>
    </Empty>
  )
}
