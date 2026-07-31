"use client"

import * as React from "react"
import { IconFilePlus } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createProjectChangeOrder } from "@/app/actions/project-change-orders"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

function optionalText(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredText(formData: FormData, name: string): string {
  return optionalText(formData, name) ?? ""
}

function amountCents(formData: FormData): number | null {
  const value = optionalText(formData, "amount")
  if (!value) return null
  const amount = Number(value.replaceAll(",", ""))
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN
}

export function ProjectChangeOrderCreateForm({
  projectId,
  detailBaseHref,
  internal,
}: {
  readonly projectId: string
  readonly detailBaseHref: string
  readonly internal: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [saving, startSaving] = React.useTransition()

  function submit(formData: FormData): void {
    startSaving(async () => {
      const documentUrl = optionalText(formData, "documentUrl")
      const result = await createProjectChangeOrder(projectId, {
        title: requiredText(formData, "title"),
        scope: requiredText(formData, "scope"),
        reason: optionalText(formData, "reason"),
        amountCents: amountCents(formData),
        audience:
          optionalText(formData, "audience") === "owner"
            ? "owner"
            : optionalText(formData, "audience") === "sub_vendor"
              ? "sub_vendor"
              : "internal",
        requesterCompany: optionalText(formData, "requesterCompany"),
        sourceRecordId: null,
        sourceHref: optionalText(formData, "sourceHref"),
        initialStatus:
          optionalText(formData, "initialStatus") === "submitted"
            ? "submitted"
            : "draft",
        documents: documentUrl
          ? [
              {
                label:
                  optionalText(formData, "documentLabel") ??
                  "Supporting document",
                url: documentUrl,
                notes: null,
              },
            ]
          : [],
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      toast.success("Change order request created.")
      router.push(`${detailBaseHref}/${encodeURIComponent(result.id)}`)
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <IconFilePlus className="size-4" />
          Request change
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Request a change order</SheetTitle>
          <SheetDescription>
            Describe the requested scope and attach a supporting document link.
            This does not approve work or send anything to Sage or Foxit.
          </SheetDescription>
        </SheetHeader>
        <form action={submit} className="space-y-5 px-4 pb-6">
          <div className="space-y-2">
            <Label htmlFor="change-order-title">Title</Label>
            <Input id="change-order-title" name="title" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-order-scope">Requested scope</Label>
            <Textarea
              id="change-order-scope"
              name="scope"
              rows={6}
              required
              placeholder="Describe what should change and the desired result."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-order-reason">Reason</Label>
            <Textarea id="change-order-reason" name="reason" rows={3} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="change-order-amount">
                Requested amount (optional)
              </Label>
              <Input
                id="change-order-amount"
                name="amount"
                type="number"
                step="0.01"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="change-order-company">Company</Label>
              <Input id="change-order-company" name="requesterCompany" />
            </div>
          </div>
          {internal && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="change-order-audience">Audience</Label>
                <select
                  id="change-order-audience"
                  name="audience"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  defaultValue="internal"
                >
                  <option value="internal">Internal only</option>
                  <option value="owner">Owner visible when approved</option>
                  <option value="sub_vendor">Sub/vendor request</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="change-order-initial-status">Save as</Label>
                <select
                  id="change-order-initial-status"
                  name="initialStatus"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  defaultValue="draft"
                >
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted for triage</option>
                </select>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="change-order-source">Source link (optional)</Label>
            <Input
              id="change-order-source"
              name="sourceHref"
              type="url"
              placeholder="https://..."
            />
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium">Supporting document</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Link a plan, estimate, photo folder, or other project document.
            </p>
            <div className="mt-3 grid gap-3">
              <Input name="documentLabel" placeholder="Document label" />
              <Input
                name="documentUrl"
                type="url"
                placeholder="https://..."
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : internal ? "Create request" : "Submit request"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
