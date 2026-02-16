"use client"

import Link from "next/link"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface DemoBannerProps {
  readonly isDemo: boolean
}

export function DemoBanner({ isDemo }: DemoBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (!isDemo || dismissed) return null

  return (
    <div
      className={cn(
        "relative flex items-center justify-center gap-3",
        "border-b bg-muted/30 px-4 py-2 text-sm"
      )}
    >
      <span className="text-muted-foreground">
        You&rsquo;re exploring a demo workspace
      </span>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/signup">Sign up</Link>
        </Button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-4 p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
