"use client"

import * as React from "react"
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandX,
  IconExternalLink,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  disconnectSocialAccount,
  finalizeMetaConnection,
  getPendingMetaConnection,
  getSocialAccounts,
} from "@/app/actions/social-connections"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  socialDepartmentDestination,
  type SocialAccountSummary,
} from "@/lib/social/types"

const DEPARTMENTS = [
  { value: "O", label: "Open Range Construction" },
  { value: "H", label: "High Performance Structures" },
  { value: "N", label: "Nu-Tech Systems" },
  { value: "D", label: "Design only" },
] as const

type MetaDraft = {
  readonly draftId: string
  readonly department: string
  readonly candidates: readonly {
    readonly pageId: string
    readonly pageName: string
    readonly instagramUsername: string | null
  }[]
}

function platformIcon(platform: string): React.ReactElement {
  if (platform === "instagram") return <IconBrandInstagram className="size-4" />
  if (platform === "x") return <IconBrandX className="size-4" />
  return <IconBrandFacebook className="size-4" />
}

export function SocialConnectionsCard(): React.ReactElement {
  const [accounts, setAccounts] = React.useState<readonly SocialAccountSummary[]>([])
  const [draft, setDraft] = React.useState<MetaDraft | null>(null)
  const [selectedPageId, setSelectedPageId] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [pending, startTransition] = React.useTransition()

  const loadAccounts = React.useCallback(async (): Promise<void> => {
    setAccounts(await getSocialAccounts())
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void loadAccounts()
    const params = new URLSearchParams(window.location.search)
    if (params.get("social") === "x-profile-mismatch") {
      toast.error("That X profile does not match the approved profile for this department.")
    }
    if (params.get("social") === "meta-permissions-missing") {
      toast.error(
        "Meta did not grant all publishing permissions for that Page. Edit Compass access in Meta, enable the department’s Facebook and Instagram accounts, then reconnect.",
      )
    }
    const draftId = params.get("social-draft")
    if (!draftId) return
    void getPendingMetaConnection(draftId).then((result) => {
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDraft(result)
      setSelectedPageId(result.candidates[0]?.pageId ?? "")
    })
  }, [loadAccounts])

  function finishMetaConnection(): void {
    if (!draft || !selectedPageId) return
    startTransition(async () => {
      const result = await finalizeMetaConnection({
        draftId: draft.draftId,
        pageId: selectedPageId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Facebook and linked Instagram destinations connected.")
      setDraft(null)
      await loadAccounts()
      window.history.replaceState({}, "", "/dashboard/settings?social=connected")
    })
  }

  function disconnect(account: SocialAccountSummary): void {
    startTransition(async () => {
      const result = await disconnectSocialAccount(account.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${account.accountName} disconnected from Compass.`)
      await loadAccounts()
    })
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Social publishing</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Each project routes to Facebook, Instagram, and X accounts connected for its department.
          </p>
        </div>
        <Badge variant="outline">Administrator managed</Badge>
      </div>

      {draft ? (
        <div className="mt-4 rounded-md border bg-muted/30 p-3">
          <Label htmlFor="meta-page">Choose the department’s Facebook Page</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            The linked professional Instagram account will be connected at the same time when available.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Select value={selectedPageId} onValueChange={setSelectedPageId}>
              <SelectTrigger id="meta-page" className="flex-1">
                <SelectValue placeholder="Choose a Page" />
              </SelectTrigger>
              <SelectContent>
                {draft.candidates.map((candidate) => (
                  <SelectItem key={candidate.pageId} value={candidate.pageId}>
                    {candidate.pageName}
                    {candidate.instagramUsername ? ` · @${candidate.instagramUsername}` : " · no linked Instagram"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" onClick={finishMetaConnection} disabled={pending || !selectedPageId}>
              Use this Page
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 divide-y border-y">
        {DEPARTMENTS.map((department) => {
          const destination = socialDepartmentDestination(department.value)
          const departmentAccounts = accounts.filter(
            (account) => account.department === department.value,
          )
          return (
            <div key={department.value} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{department.label}</p>
                  <p className="text-xs text-muted-foreground">Department {department.value}</p>
                  <p className="text-xs text-muted-foreground">
                    {destination.facebookPageName} · @{destination.instagramUsername} · {destination.xHandle}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/social/meta/connect?department=${department.value}`}>
                      <IconBrandFacebook className="size-4" />
                      Connect Meta
                      <IconExternalLink className="size-3" />
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/social/x/connect?department=${department.value}`}>
                      <IconBrandX className="size-4" />
                      Sign in to {destination.xHandle}
                      <IconExternalLink className="size-3" />
                    </a>
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {departmentAccounts.map((account) => (
                  <span key={account.id} className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                    {platformIcon(account.platform)}
                    <span>{account.accountName}</span>
                    <Badge variant={account.status === "connected" ? "secondary" : "destructive"}>
                      {account.status}
                    </Badge>
                    {account.status === "connected" ? <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button type="button" className="text-muted-foreground underline" disabled={pending}>
                          Disconnect
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Disconnect {account.accountName}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Compass will remove its encrypted token and stop offering this destination. Published posts and their audit history will remain. This does not delete content from the social platform.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep connected</AlertDialogCancel>
                          <AlertDialogAction onClick={() => disconnect(account)}>Disconnect</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog> : <span className="text-muted-foreground">Reconnect above</span>}
                  </span>
                ))}
                {!loading && departmentAccounts.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No accounts connected.</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Meta requires managed Facebook Pages and linked professional Instagram accounts. X requires a developer app with posting access. Tokens are encrypted at rest.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        X passwords are entered only on X’s authorization screen and are never sent to or stored by Compass. Each business profile should use a unique password and multi-factor authentication.
      </p>
    </section>
  )
}
