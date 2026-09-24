"use client"

import type * as React from "react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"

export function InboundSmsRouteSubmitButton(): React.ReactElement {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Routing…" : "Route to Compass"}
    </Button>
  )
}
