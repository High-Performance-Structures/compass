"use client"

/*
 * The persistent View as bar: "Viewing as <Name> — read only · Exit". Shown
 * above every dashboard and portal screen while viewing. When the session is
 * no longer allowed (developer mode off, setting changed, expired) it says
 * why and offers only Exit, since the request stays read only until then.
 */
import * as React from "react"
import { IconEye } from "@tabler/icons-react"
import { toast } from "sonner"

import { exitViewAs } from "@/app/actions/view-as"
import { Button } from "@/components/ui/button"

export function ViewAsBar({
  targetName,
  problem,
}: {
  readonly targetName: string | null
  readonly problem: string | null
}): React.ReactElement {
  const [leaving, setLeaving] = React.useState(false)

  async function leave(): Promise<void> {
    setLeaving(true)
    const result = await exitViewAs()
    if (!result.success) toast.error(result.error)
    // A full load drops every cached screen of the viewed person.
    window.location.assign("/dashboard")
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warning/15 px-4 py-1.5 text-sm print:hidden"
    >
      <IconEye className="size-4 shrink-0" aria-hidden />
      <p className="font-medium">
        {targetName ? <>Viewing as {targetName} — read only</> : <>View as has ended</>}
        {problem ? <span className="font-normal text-muted-foreground"> · {problem}</span> : null}
      </p>
      <span aria-hidden className="text-muted-foreground">·</span>
      <Button type="button" size="sm" variant="outline" className="h-7" disabled={leaving} onClick={() => void leave()}>
        {leaving ? "Leaving…" : "Exit"}
      </Button>
    </div>
  )
}
