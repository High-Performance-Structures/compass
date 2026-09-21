"use client"

import { FormEvent, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import {
  activateProjectFamilyPhase,
  createProjectFamilyFromProject,
  createProjectFamilyPhase,
  provisionProjectFamilyPhaseDriveFolder,
} from "@/app/actions/project-families"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ProjectFamilySetupPrompt({
  projectId,
  projectName,
}: {
  readonly projectId: string
  readonly projectName: string
}): React.ReactElement {
  const router = useRouter()
  const [familyName, setFamilyName] = useState(projectName)
  const [phaseName, setPhaseName] = useState(projectName)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectFamilyFromProject({
        projectId,
        familyName,
        phaseName,
      })
      if (!result.success) {
        setMessage(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="mb-4 rounded-lg border p-3 sm:mb-5 sm:p-4">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        Project family
      </p>
      <h2 className="mt-1 text-base font-semibold">Group this project into phases</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        This creates a family and links the current project as Phase 1. It does
        not create another project, contract, budget, or change order.
      </p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="project-family-name">Family name</Label>
          <Input
            id="project-family-name"
            value={familyName}
            onChange={(event) => setFamilyName(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-family-phase-name">Current phase name</Label>
          <Input
            id="project-family-phase-name"
            value={phaseName}
            onChange={(event) => setPhaseName(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating family..." : "Create project family"}
          </Button>
          {message && <p className="mt-2 text-sm text-destructive">{message}</p>}
        </div>
      </form>
    </section>
  )
}

export function ProjectFamilyPhaseCreateForm({
  familyId,
  nextSequence,
}: {
  readonly familyId: string
  readonly nextSequence: number
}): React.ReactElement {
  const router = useRouter()
  const [sequence, setSequence] = useState(String(nextSequence))
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [authorizedAmount, setAuthorizedAmount] = useState("")
  const [authorizedAt, setAuthorizedAt] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectFamilyPhase({
        familyId,
        sequence: Number.parseInt(sequence, 10),
        name,
        description: description.trim() || null,
        jobStatusId: "awaiting_funding",
        originatingChangeOrderId: null,
        authorizedContractAmountCents: authorizedAmount.trim()
          ? Math.round(Number(authorizedAmount) * 100)
          : null,
        authorizedAt: authorizedAt
          ? `${authorizedAt}T00:00:00.000Z`
          : null,
      })
      if (!result.success) {
        setMessage(result.error)
        return
      }
      if (result.warning) {
        setMessage(
          `${result.projectNumber ?? "Phase"} created; Drive setup is pending: ${result.warning}`,
        )
      }
      setName("")
      setDescription("")
      setAuthorizedAmount("")
      setAuthorizedAt("")
      setSequence(String(nextSequence + 1))
      router.refresh()
    })
  }

  return (
    <form className="mt-4 border-t pt-4" onSubmit={submit}>
      <p className="text-sm font-medium">Plan another phase</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The original project is Phase 1. This creates the next phased project
        number (for example, O-64-660-1), provisions its Drive subfolder, and
        does not launch a project or authorize spending.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[6rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="project-family-next-sequence">Phase</Label>
          <Input
            id="project-family-next-sequence"
            type="number"
            min="2"
            value={sequence}
            onChange={(event) => setSequence(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-family-authorized-amount">Authorized contract amount</Label>
          <Input
            id="project-family-authorized-amount"
            type="number"
            min="0"
            step="0.01"
            value={authorizedAmount}
            onChange={(event) => setAuthorizedAmount(event.target.value)}
            placeholder="Optional"
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-family-authorized-at">Authorization date</Label>
          <Input
            id="project-family-authorized-at"
            type="date"
            value={authorizedAt}
            onChange={(event) => setAuthorizedAt(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-family-next-name">Phase name</Label>
          <Input
            id="project-family-next-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Future funded scope"
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="project-family-next-description">Scope notes</Label>
          <Textarea
            id="project-family-next-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this phase is expected to include"
            disabled={isPending}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={isPending}>
          {isPending ? "Saving..." : "Save planned phase"}
        </Button>
        {message && <p className="text-sm text-destructive">{message}</p>}
      </div>
    </form>
  )
}

export function ProjectFamilyPhaseActivateButton({
  phaseId,
}: {
  readonly phaseId: string
}): React.ReactElement {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function activate(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await activateProjectFamilyPhase(phaseId)
      if (!result.success) {
        setMessage(result.error)
        return
      }
      if (result.warning) setMessage(result.warning)
      router.refresh()
    })
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={activate} disabled={isPending}>
        {isPending ? "Activating..." : "Create phase project"}
      </Button>
      {message && <p className="max-w-xs text-right text-xs text-destructive">{message}</p>}
    </div>
  )
}

export function ProjectFamilyPhaseDriveRetryButton({
  phaseId,
}: {
  readonly phaseId: string
}): React.ReactElement {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function retry(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await provisionProjectFamilyPhaseDriveFolder(phaseId)
      if (!result.success) {
        setMessage(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={retry} disabled={isPending}>
        {isPending ? "Retrying..." : "Retry phase Drive setup"}
      </Button>
      {message && <p className="max-w-xs text-right text-xs text-destructive">{message}</p>}
    </div>
  )
}
