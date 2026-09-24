"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

export default function PeoplePage() {
  const router = useRouter()

  React.useEffect(() => {
    router.replace("/dashboard/contacts?tab=internal")
  }, [router])

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-muted-foreground">
        People and account access have moved to Contacts.
      </p>
    </div>
  )
}
