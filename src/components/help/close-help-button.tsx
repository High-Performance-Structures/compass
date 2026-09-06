"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

export function CloseHelpButton(): React.ReactElement {
  const router = useRouter()

  function closeHelp(): void {
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
