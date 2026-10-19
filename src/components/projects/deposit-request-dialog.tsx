"use client"

import { useRouter } from "next/navigation"
import { useTransition, type FormEvent } from "react"
import { toast } from "sonner"

import { requestProjectContractDeposit } from "@/app/actions/project-contract-deposits"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { printPreviewHref } from "@/lib/print/print-documents"

/** Request a deposit from the client; the request prints as a Deposit Request. */
export function DepositRequestDialog({
  projectId,
  suggestedCents,
  open,
  onOpenChange,
}: {
  readonly projectId: string
  readonly suggestedCents: number | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const raw = String(formData.get("amount") ?? "").replaceAll(/[$,]/g, "").trim()
    const amount = raw ? Number(raw) : null
    const dueDate = String(formData.get("dueDate") ?? "").trim() || null
    const message = String(formData.get("message") ?? "").trim() || null
    startTransition(async () => {
      const result = await requestProjectContractDeposit(projectId, { amount, dueDate, message })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      onOpenChange(false)
      toast.success("Deposit requested. It shows to the owner now.", {
        action: {
          label: "Print Preview",
          onClick: () => window.open(printPreviewHref({ projectId, document: "deposit-request", params: { depositId: result.id } }), "_blank", "noopener"),
        },
      })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a deposit</DialogTitle>
          <DialogDescription>
            Creates a Deposit Request to print or email to the client. It also shows in the owner&apos;s portal. Record the
            payment on it when it arrives.
          </DialogDescription>
        </DialogHeader>
        <form id="deposit-request-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="deposit-request-amount">Deposit amount</Label>
            <Input
              id="deposit-request-amount"
              name="amount"
              inputMode="decimal"
              required
              defaultValue={suggestedCents ? (suggestedCents / 100).toFixed(2) : ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deposit-request-due">Due date</Label>
            <Input id="deposit-request-due" name="dueDate" type="date" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="deposit-request-message">Note to the client (printed on the request)</Label>
            <Textarea id="deposit-request-message" name="message" rows={3} maxLength={2000} />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="deposit-request-form" disabled={pending}>
            {pending ? "Requesting…" : "Request deposit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
