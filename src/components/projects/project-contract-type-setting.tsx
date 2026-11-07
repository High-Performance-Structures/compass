"use client"

import { useState, useTransition, type ReactElement } from "react"

import { updateProjectContractType } from "@/app/actions/project-profile"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PROJECT_CONTRACT_TYPES, type ProjectContractType } from "@/lib/domain/project/statuses"
import { contractTypeLabel } from "@/lib/domain/estimates/variance-rules"

const COMPANY_DEFAULT = "default"

const HELP: Readonly<Record<ProjectContractType, string>> = {
  fixed_price: "Price changes are renegotiated with change orders; the job has no variances.",
  cost_plus: "Variances change their cost code's scheduled value, and the builder fee follows variances and change orders.",
  cost_plus_fixed_fee: "Variances change their cost code's scheduled value; the builder fee changes only with change orders.",
}

function isContractType(value: string): value is ProjectContractType {
  return PROJECT_CONTRACT_TYPES.some((type) => type === value)
}

/**
 * Per-project owner contract type, which decides whether the job takes
 * variances and whether the builder fee follows them. Saves on its own like
 * the map setting.
 */
export function ProjectContractTypeSetting(props: {
  readonly projectId: string
  readonly contractType: ProjectContractType | null
}): ReactElement {
  const [value, setValue] = useState<string>(props.contractType ?? COMPANY_DEFAULT)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-2">
      <Label htmlFor="project-contract-type">Contract type</Label>
      <Select
        value={value}
        disabled={pending}
        onValueChange={(next) => {
          const previous = value
          setValue(next)
          setMessage(null)
          startTransition(async () => {
            const result = await updateProjectContractType({
              projectId: props.projectId,
              contractType: isContractType(next) ? next : null,
            })
            if (!result.success) {
              setValue(previous)
              setMessage(result.error)
              return
            }
            setMessage("Contract type saved.")
          })
        }}
      >
        <SelectTrigger id="project-contract-type" className="h-9 w-full" aria-describedby="project-contract-type-help">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={COMPANY_DEFAULT}>Company default</SelectItem>
          {PROJECT_CONTRACT_TYPES.map((type) => (
            <SelectItem key={type} value={type}>{contractTypeLabel(type)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id="project-contract-type-help" className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {message ??
          (isContractType(value)
            ? HELP[value]
            : "Follows Settings → Workflows → Variances. Choose the type on the signed contract.")}
      </p>
    </div>
  )
}
