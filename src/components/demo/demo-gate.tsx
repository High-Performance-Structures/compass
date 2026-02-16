"use client"

import { useState } from "react"
import { DemoCtaDialog } from "./demo-cta-dialog"

export function DemoGate({
  children,
  isDemo,
}: {
  readonly children: React.ReactNode
  readonly isDemo: boolean
}) {
  const [showCta, setShowCta] = useState(false)

  if (!isDemo) return <>{children}</>

  return (
    <>
      <div
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setShowCta(true)
        }}
      >
        {children}
      </div>
      <DemoCtaDialog open={showCta} onOpenChange={setShowCta} />
    </>
  )
}
