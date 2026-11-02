"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
  connectUnassignedPersonToCompany,
  findUnassignedConnectCompanies,
  getUnassignedCompanySuggestion,
} from "@/app/actions/unassigned-people"
import { CompanySearchPicker, type MergeChoice } from "@/components/contacts/company-merge-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ConnectCompanyKind, ConnectUnassignedOutcome } from "@/lib/domain/contacts/connect-unassigned-person"
import type { UnassignedPerson } from "@/lib/domain/contacts/unassigned-people"
import { projectNumberAndName } from "@/lib/project-display-name"

const KIND_LABELS: Record<ConnectCompanyKind, string> = { vendor: "Vendor", customer: "Owner / Client" }

/**
 * "Connect to company…" for one unassigned person: pick a vendor or client
 * and the person is added to it (or matched to the person already there)
 * and linked on every project they appear on. No one is invited or told,
 * and imported conversations stay staff-only until staff share them.
 */
export function ConnectUnassignedDialog({
  person,
  kinds,
  onOpenChange,
  onConnected,
}: {
  readonly person: UnassignedPerson | null
  /** The company kinds this user may add people to. */
  readonly kinds: readonly ConnectCompanyKind[]
  readonly onOpenChange: (open: boolean) => void
  /** Called after a connect; `complete` is false when some projects could not be linked. */
  readonly onConnected: (identity: string, complete: boolean) => void
}): React.ReactElement {
  const [kind, setKind] = React.useState<ConnectCompanyKind>(kinds[0] ?? "vendor")
  const [choice, setChoice] = React.useState<(MergeChoice & { readonly kind: ConnectCompanyKind }) | null>(null)
  const [suggested, setSuggested] = React.useState(false)
  const [outcome, setOutcome] = React.useState<ConnectUnassignedOutcome | null>(null)
  const [pending, startTransition] = React.useTransition()

  const identity = person?.identity ?? null
  const companyName = person?.companyName ?? null
  React.useEffect(() => {
    setChoice(null)
    setSuggested(false)
    setOutcome(null)
    setKind(kinds[0] ?? "vendor")
    if (!identity || !companyName) return
    let active = true
    void getUnassignedCompanySuggestion(companyName).then((suggestion) => {
      if (!active || !suggestion || !kinds.includes(suggestion.kind)) return
      setKind(suggestion.kind)
      setChoice({ id: suggestion.id, name: suggestion.name, email: null, kind: suggestion.kind })
      setSuggested(true)
    }).catch(() => undefined)
    return () => { active = false }
  }, [identity, companyName, kinds])

  const find = React.useCallback((search: string) => findUnassignedConnectCompanies({ kind, search }), [kind])

  function connect(): void {
    if (!person || !choice) return
    startTransition(async () => {
      const result = await connectUnassignedPersonToCompany({ identity: person.identity, kind: choice.kind, companyId: choice.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOutcome(result.data)
      const complete = result.data.failed.length === 0
      if (complete) toast.success(`${person.name} connected to ${result.data.companyName}.`)
      else toast.warning(`${person.name} was connected on some projects only.`)
      onConnected(person.identity, complete)
    })
  }

  const projectName = (projectId: string): string => {
    const project = person?.projects.find((item) => item.projectId === projectId)
    return project ? projectNumberAndName({ projectNumber: project.projectNumber, name: project.projectName }, " - ") : projectId
  }

  return (
    <Dialog open={person !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to company</DialogTitle>
          <DialogDescription>
            {person ? `${person.name}${person.email ? ` · ${person.email}` : ""}` : ""}
            {companyName ? ` · Imported company: ${companyName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="space-y-3 text-sm">
            <p>
              Connected to <span className="font-medium">{outcome.companyName}</span>
              {outcome.createdPerson ? " and added to its people." : " as the person already listed there."}
            </p>
            {outcome.compassOnlyOnSageLinked ? (
              <p>
                This company is linked to Sage. The person was added in Compass only and is not in Sage. Use Propose Sage
                person on the company when they should be added to Sage.
              </p>
            ) : null}
            {outcome.failed.length > 0 ? (
              <div role="alert" className="space-y-1 text-destructive">
                <p>Not connected on:</p>
                <ul className="list-disc pl-5">
                  {outcome.failed.map((row) => <li key={row.projectId}>{projectName(row.projectId)}: {row.error}</li>)}
                </ul>
              </div>
            ) : null}
            <p className="text-muted-foreground">
              Imported conversations with this person stay staff-only. To share one, open it in the project&apos;s Messages
              and use Share with owner… or Share with vendor….
            </p>
            <ul className="space-y-0.5">
              {outcome.connected.map((row) => (
                <li key={row.contactId}>
                  <Link href={`/dashboard/projects/${encodeURIComponent(row.projectId)}/messages`} className="hover:underline">
                    {projectName(row.projectId)} messages
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {kinds.length > 1 ? (
              <ToggleGroup
                type="single"
                value={kind}
                onValueChange={(value) => {
                  const next = kinds.find((item) => item === value)
                  if (next) setKind(next)
                }}
                aria-label="Company type"
                className="grid w-full grid-cols-2"
                size="sm"
                variant="outline"
              >
                {kinds.map((item) => <ToggleGroupItem key={item} value={item}>{KIND_LABELS[item]}</ToggleGroupItem>)}
              </ToggleGroup>
            ) : null}
            {choice ? (
              <p>
                <span className="font-medium">{suggested ? "Suggested:" : "Selected:"}</span> {choice.name}
                <span className="text-muted-foreground"> ({KIND_LABELS[choice.kind]})</span>
              </p>
            ) : null}
            <CompanySearchPicker
              key={kind}
              find={find}
              label={kind === "vendor" ? "Find the vendor" : "Find the owner or client"}
              idleText={kind === "vendor" ? "Type to find the vendor this person works for." : "Type to find the owner or client."}
              emptyText="No company matches this search."
              selectedId={choice?.kind === kind ? choice.id : null}
              onSelect={(selected) => {
                setChoice({ ...selected, kind })
                setSuggested(false)
              }}
            />
            <p className="text-xs text-muted-foreground">
              No one is invited or notified. The person is added to the company, or matched to the person already listed there.
            </p>
          </div>
        )}

        <DialogFooter>
          {outcome ? (
            <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
              <Button type="button" onClick={connect} disabled={!choice || pending}>
                {pending ? "Connecting…" : "Connect"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
