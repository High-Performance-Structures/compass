"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  deleteSchedulePhaseOption,
  getSchedulePhaseOptions,
  saveSchedulePhaseOption,
  type ReusableSchedulePhaseOption,
} from "@/app/actions/schedule-phases"
import { defaultPhaseOptions, withSavedPhaseOption } from "./form-model"

export interface PhaseOptionsState {
  readonly phaseOptions: readonly ReusableSchedulePhaseOption[]
  readonly phaseOptionsLoading: boolean
  readonly customPhaseMode: boolean
  readonly customPhaseName: string
  readonly saveCustomPhase: boolean
  readonly setCustomPhaseMode: (mode: boolean) => void
  readonly setCustomPhaseName: (name: string) => void
  readonly setSaveCustomPhase: (save: boolean) => void
  readonly resetCustomPhase: () => void
  /** Saves a typed custom phase when asked; null when saving failed. */
  readonly submittedPhase: (phase: string) => Promise<string | null>
  readonly removeSelectedSavedPhase: (phase: string) => Promise<void>
}

/** Reusable phase catalog and the custom-phase entry for one project. */
export function usePhaseOptions(open: boolean, projectId: string): PhaseOptionsState {
  const [phaseOptions, setPhaseOptions] = useState<
    readonly ReusableSchedulePhaseOption[]
  >(defaultPhaseOptions)
  const [phaseOptionsLoading, setPhaseOptionsLoading] = useState(false)
  const [customPhaseMode, setCustomPhaseMode] = useState(false)
  const [customPhaseName, setCustomPhaseName] = useState("")
  const [saveCustomPhase, setSaveCustomPhase] = useState(true)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhaseOptionsLoading(true)
    void getSchedulePhaseOptions(projectId)
      .then((options) => {
        if (!cancelled) setPhaseOptions(options)
      })
      .catch((error: unknown) => {
        console.error("Unable to load reusable schedule phases", error)
        if (!cancelled) {
          setPhaseOptions(defaultPhaseOptions)
          toast.error("Unable to load saved phases. Compass defaults are available.")
        }
      })
      .finally(() => {
        if (!cancelled) setPhaseOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  // Stable so the dialog's open/reset effect can depend on it.
  const resetCustomPhase = useCallback((): void => {
    setCustomPhaseMode(false)
    setCustomPhaseName("")
    setSaveCustomPhase(true)
  }, [])

  async function submittedPhase(phase: string): Promise<string | null> {
    if (!(customPhaseMode && saveCustomPhase)) return phase
    const phaseResult = await saveSchedulePhaseOption({
      projectId,
      name: phase,
    })
    if (!phaseResult.success) {
      toast.error(phaseResult.error)
      return null
    }
    setPhaseOptions((current) => withSavedPhaseOption(current, phaseResult.option))
    return phaseResult.option.value
  }

  async function removeSelectedSavedPhase(phase: string): Promise<void> {
    const selected = phaseOptions.find(
      (option) => option.value === phase && option.source === "saved"
    )
    if (!selected?.id) return
    if (
      !window.confirm(
        `Remove “${selected.label}” from the reusable phase catalog? Existing schedule items and templates will not change.`
      )
    ) {
      return
    }
    const result = await deleteSchedulePhaseOption({
      projectId,
      optionId: selected.id,
    })
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setPhaseOptions((current) =>
      current.filter((option) => option.id !== selected.id)
    )
    toast.success(
      "Removed from the reusable catalog. It may still appear where it is already in use."
    )
  }

  return {
    phaseOptions,
    phaseOptionsLoading,
    customPhaseMode,
    customPhaseName,
    saveCustomPhase,
    setCustomPhaseMode,
    setCustomPhaseName,
    setSaveCustomPhase,
    resetCustomPhase,
    submittedPhase,
    removeSelectedSavedPhase,
  }
}
