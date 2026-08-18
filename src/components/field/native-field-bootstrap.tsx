"use client"

import { useEffect, useState } from "react"

import type {
  FieldProject,
  FieldProjectPacket,
  FieldUserProfile,
} from "@/lib/field/types"
import {
  cacheNativeFieldProfile,
  cacheNativeFieldProjects,
  cacheNativeFieldState,
} from "@/lib/native/field-store"

type BootstrapStatus = "preparing" | "returning" | "ready" | "error"

export function NativeFieldBootstrap({
  profile,
  projects,
  initialPacket,
}: {
  readonly profile: FieldUserProfile
  readonly projects: readonly FieldProject[]
  readonly initialPacket: FieldProjectPacket | null
}): React.ReactElement {
  const [status, setStatus] = useState<BootstrapStatus>("preparing")

  function returnToFieldMode(): void {
    window.location.assign("compass://field")
  }

  useEffect(() => {
    let cancelled = false
    let fallbackTimer: number | null = null

    async function prepareFieldMode(): Promise<void> {
      try {
        await Promise.all([
          cacheNativeFieldProfile(profile),
          initialPacket
            ? cacheNativeFieldState(projects, initialPacket)
            : cacheNativeFieldProjects(projects),
        ])
        if (cancelled) return

        setStatus("returning")
        window.location.replace("compass://field")
        fallbackTimer = window.setTimeout(() => {
          setStatus("ready")
        }, 1_500)
      } catch {
        if (!cancelled) setStatus("error")
      }
    }

    void prepareFieldMode()
    return () => {
      cancelled = true
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
    }
  }, [initialPacket, profile, projects])

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
        HPS Compass
      </p>
      <h1 className="text-2xl font-semibold">Preparing Field Mode</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        {status === "preparing" && "Downloading your assigned projects for offline use."}
        {status === "returning" && "Your projects are ready. Returning to the Field app."}
        {status === "ready" && "Field Mode is ready on this device."}
        {status === "error" && "Compass could not prepare Field Mode. Check your connection and try again."}
      </p>
      {(status === "ready" || status === "error") && (
        <button
          type="button"
          onClick={returnToFieldMode}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Return to Field Mode
        </button>
      )}
    </main>
  )
}
