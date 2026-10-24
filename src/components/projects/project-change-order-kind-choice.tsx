"use client"

import type * as React from "react"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  isChoosableChangeOrderKind,
  type ChoosableChangeOrderKind,
} from "@/lib/change-orders/kinds"

type EstimateOption = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
}

const KIND_OPTIONS: readonly {
  readonly kind: ChoosableChangeOrderKind
  readonly label: string
  readonly description: string
}[] = [
  {
    kind: "estimate",
    label: "Price it with an estimate",
    description:
      "Build the change in the estimate editor with phases, assemblies and cost codes. Accepting the estimate executes the change order and updates the budget.",
  },
  {
    kind: "description",
    label: "Description only (no cost)",
    description:
      "Documents a scope, plan or contract-language change that doesn't change the price. It never changes the budget.",
  },
  {
    kind: "replacement",
    label: "Replace the contract estimate",
    description:
      "A newer version of the contract estimate becomes the baseline before work is bought or billed (for example, for a lender).",
  },
]

/** How a change order is built, and the replacement version when it replaces the contract. */
export function ProjectChangeOrderKindChoice({
  kind,
  onKindChange,
  replacementEstimateId,
  onReplacementEstimateChange,
  replacementOptions,
  currentBaseline,
  disabled,
  lockedKinds = [],
}: {
  readonly kind: ChoosableChangeOrderKind | null
  readonly onKindChange: (kind: ChoosableChangeOrderKind) => void
  readonly replacementEstimateId: string
  readonly onReplacementEstimateChange: (id: string) => void
  readonly replacementOptions: readonly EstimateOption[]
  readonly currentBaseline: EstimateOption | null
  readonly disabled: boolean
  /** Kinds that can't be chosen right now, with the reason shown. */
  readonly lockedKinds?: readonly { readonly kind: ChoosableChangeOrderKind; readonly reason: string }[]
}): React.ReactElement {
  return (
    <div className="space-y-3 border-y py-4">
      <p className="text-xs font-medium text-muted-foreground">How is this change order built?</p>
      <RadioGroup
        value={kind ?? ""}
        onValueChange={(value) => {
          if (isChoosableChangeOrderKind(value)) onKindChange(value)
        }}
        className="gap-3"
        disabled={disabled}
      >
        {KIND_OPTIONS.map((option) => {
          const locked =
            lockedKinds.find((item) => item.kind === option.kind)?.reason ??
            (option.kind === "replacement" && !currentBaseline
              ? "Needs an accepted contract estimate."
              : null)
          return (
            <label key={option.kind} className="flex items-start gap-2 text-sm">
              <RadioGroupItem value={option.kind} disabled={disabled || locked !== null} className="mt-0.5" />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
                {locked && kind !== option.kind && (
                  <span className="block text-xs text-muted-foreground">{locked}</span>
                )}
              </span>
            </label>
          )
        })}
      </RadioGroup>
      {kind === "replacement" && (
        <div className="space-y-1.5 sm:max-w-md">
          <Label htmlFor="change-order-replacement-estimate">Replacement estimate</Label>
          <Select
            name="replacementEstimateId"
            value={replacementEstimateId}
            required
            disabled={disabled}
            onValueChange={onReplacementEstimateChange}
          >
            <SelectTrigger id="change-order-replacement-estimate" className="h-9 w-full">
              <SelectValue placeholder="Choose a revised estimate" />
            </SelectTrigger>
            <SelectContent>
              {replacementOptions.map((estimate) => (
                <SelectItem key={estimate.id} value={estimate.id}>
                  {estimate.estimateNumber} v{estimate.versionNumber} · {estimate.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Current baseline:{" "}
            {currentBaseline
              ? `${currentBaseline.estimateNumber} v${currentBaseline.versionNumber}`
              : "No accepted estimate"}
            . When the owners sign a new version, recording its acceptance on the estimate page creates this
            change order for you.
          </p>
        </div>
      )}
    </div>
  )
}
