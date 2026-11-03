"use client"

import { useState, useTransition, type ReactElement } from "react"

import { updateProjectImportedConversationsStaffOnly } from "@/app/actions/project-profile"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/**
 * Per-project switch that keeps imported conversations (for example messages
 * brought over from a previous system) visible to internal staff only. Used
 * for a project under a legal hold; saves on its own like the map setting.
 */
export function ImportedConversationsSetting(props: {
  readonly projectId: string
  readonly staffOnly: boolean
}): ReactElement {
  const [staffOnly, setStaffOnly] = useState(props.staffOnly)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="imported-conversations-staff-only">Imported conversations staff only</Label>
        <Switch
          id="imported-conversations-staff-only"
          checked={staffOnly}
          disabled={pending}
          aria-describedby="imported-conversations-staff-only-help"
          onCheckedChange={(next) => {
            const previous = staffOnly
            setStaffOnly(next)
            setMessage(null)
            startTransition(async () => {
              const result = await updateProjectImportedConversationsStaffOnly({
                projectId: props.projectId,
                staffOnly: next,
              })
              if (!result.success) {
                setStaffOnly(previous)
                setMessage(result.error)
                return
              }
              setMessage(next ? "Imported conversations are now staff only." : "Imported conversations are shared with their owner and vendor participants.")
            })
          }}
        />
      </div>
      <p id="imported-conversations-staff-only-help" className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {message ?? "When on, conversations imported from a previous system stay visible to staff only; owners and vendors in them cannot open them. Use it for a project under a legal hold."}
      </p>
    </div>
  )
}
