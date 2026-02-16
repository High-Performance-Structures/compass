"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

export default function PeoplePage() {
  const router = useRouter()

  React.useEffect(() => {
    router.replace("/dashboard")
  }, [router])

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-muted-foreground">
        Team management has moved to Settings.
      </p>
    </div>
  )
}
