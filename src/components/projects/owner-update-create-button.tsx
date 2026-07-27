"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconFilePlus } from "@tabler/icons-react"

import { createManualOwnerProjectUpdateDraft } from "@/app/actions/project-field"
import { Button } from "@/components/ui/button"

function localDateValue(): string {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}

export function OwnerUpdateCreateButton({
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function createDraft(): void {
    setError(null)
    startTransition(async () => {
      const result = await createManualOwnerProjectUpdateDraft(
        projectId,
        localDateValue()
      )
      if (!result.success) {
        setError(result.error)
        return
      }

      router.push(
        `/dashboard/projects/${projectId}/owner-updates/${result.updateId}`
      )
    })
  }

  return (
    <div>
      <Button
        type="button"
        onClick={createDraft}
        disabled={isPending}
      >
        <IconFilePlus className="size-4" />
        {isPending ? "Creating..." : "Create Owner Update"}
      </Button>
      {error !== null && (
        <p className="mt-1 max-w-64 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
