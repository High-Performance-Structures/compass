"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition, type FormEvent } from "react"
import { IconArrowBackUp, IconReceipt } from "@tabler/icons-react"

import {
  approveProjectOwnerPayApplicationForBilling,
  setProjectOwnerPayApplicationSageInvoice,
  undoProjectOwnerPayApplicationBilling,
} from "@/app/actions/pay-application-billing"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Readable pay application statuses. */
export function payApplicationStatusLabel(status: string): string {
  if (status === "internal_review") return "Ready for review"
  if (status === "billed") return "Billed"
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
}

function billedDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Approve for billing (in review), or take it back and record the Sage invoice (billed). */
export function PayApplicationBillingControls({
  projectId,
  application,
  onMessage,
}: {
  readonly projectId: string
  readonly application: {
    readonly id: string
    readonly applicationNumber: string
    readonly status: string
    readonly billedAt: string | null
    readonly sageInvoiceNumber: string | null
  }
  readonly onMessage: (message: string) => void
}): React.ReactElement | null {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [invoice, setInvoice] = useState(application.sageInvoiceNumber ?? "")

  function run(action: () => Promise<{ readonly success: true } | { readonly success: false; readonly error: string }>, done: string): void {
    startTransition(async () => {
      const result = await action()
      onMessage(result.success ? done : result.error)
      router.refresh()
    })
  }

  function saveInvoice(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    run(
      () => setProjectOwnerPayApplicationSageInvoice(projectId, application.id, invoice),
      invoice.trim() ? `Sage invoice ${invoice.trim()} recorded.` : "Sage invoice number cleared."
    )
  }

  if (application.status === "internal_review") {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={pending}>
            <IconReceipt className="size-4" />
            Approve for billing
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve pay application {application.applicationNumber} for billing?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;s marked billed and published to the owner, who can open its G702/G703 in the client portal. Record the
              Sage invoice number once it&apos;s entered in Sage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(
                () => approveProjectOwnerPayApplicationForBilling(projectId, application.id),
                `Pay application ${application.applicationNumber} is billed and visible to the owner.`
              )}
            >
              Approve for billing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  if (application.status !== "billed") return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {application.billedAt && (
        <span className="text-xs text-muted-foreground">Billed {billedDate(application.billedAt)} · visible to the owner</span>
      )}
      <form onSubmit={saveInvoice} className="flex items-center gap-2">
        <Label htmlFor={`sage-invoice-${application.id}`} className="text-xs text-muted-foreground">Sage invoice</Label>
        <Input
          id={`sage-invoice-${application.id}`}
          className="h-9 w-32"
          value={invoice}
          maxLength={60}
          placeholder="Not entered"
          onChange={(event) => setInvoice(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending || invoice.trim() === (application.sageInvoiceNumber ?? "")}>
          Save
        </Button>
      </form>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={pending}>
            <IconArrowBackUp className="size-4" />
            Undo approval
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take back billing approval for pay application {application.applicationNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes back to review and is hidden from the owner again. Use this to fix a mistake before the owner acts on it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it billed</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(
                () => undoProjectOwnerPayApplicationBilling(projectId, application.id),
                `Pay application ${application.applicationNumber} is back in review and hidden from the owner.`
              )}
            >
              Undo approval
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
