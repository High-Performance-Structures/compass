"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

export function CloseHelpButton({
  returnTo,
}: {
  readonly returnTo?: string
}): React.ReactElement {
  const router = useRouter()

  function closeHelp(): void {
    if (returnTo) {
      router.push(returnTo)
      return
    }
    window.close()
    window.setTimeout(() => {
      if (!window.closed) router.back()
    }, 100)
  }

  return (
    <Button variant="outline" size="sm" onClick={closeHelp}>
      <IconX className="size-4" />
      Close help
    </Button>
  )
}
