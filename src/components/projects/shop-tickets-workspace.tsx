"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconPlus, IconPrinter } from "@tabler/icons-react"
import { toast } from "sonner"

import { voidShopTicket, type ShopTicketWorkspace } from "@/app/actions/shop-tickets"
import { ShopTicketEditor } from "@/components/projects/shop-ticket-editor"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ShopTicketStatus } from "@/db/schema-shop-tickets"
import type { ShopTicketWithLines } from "@/lib/shop-tickets/data"
import { formatCents, payApplicationLabel } from "@/lib/shop-tickets/model"
import { cn } from "@/lib/utils"

const STATUS_LABEL: { readonly [K in ShopTicketStatus]: string } = { draft: "Draft", issued: "Issued", void: "Void" }
const STATUS_CLASS: { readonly [K in ShopTicketStatus]: string } = {
  draft: "text-primary",
  issued: "text-success",
  void: "text-destructive line-through",
}

function formatDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

type EditorState = { readonly mode: "closed" } | { readonly mode: "new" } | { readonly mode: "edit"; readonly ticket: ShopTicketWithLines }

export function ShopTicketsWorkspace({
  projectId,
  workspace,
}: {
  readonly projectId: string
  readonly workspace: ShopTicketWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [editor, setEditor] = React.useState<EditorState>({ mode: "closed" })
  const [voiding, setVoiding] = React.useState<ShopTicketWithLines | null>(null)
  const [voidReason, setVoidReason] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  function confirmVoid(): void {
    if (!voiding) return
    const ticket = voiding
    startTransition(async () => {
      const result = await voidShopTicket(projectId, ticket.id, voidReason)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${ticket.ticketNumber} voided`)
      setVoiding(null)
      setVoidReason("")
      router.refresh()
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Bills {workspace.project.projectNumber ?? "this project"} for labor and machine hours at the set rates in the rate book.
          {workspace.budgetCostCodes.length > 0 ? " Cost codes are checked against the project budget." : " This project has no budget, so cost codes aren't checked."}
        </p>
        {workspace.canEdit && editor.mode === "closed" ? (
          <Button type="button" onClick={() => setEditor({ mode: "new" })}>
            <IconPlus className="size-4" />
            New shop ticket
          </Button>
        ) : null}
      </div>

      {editor.mode !== "closed" ? (
        <ShopTicketEditor
          key={editor.mode === "edit" ? editor.ticket.id : "new"}
          projectId={projectId}
          workspace={workspace}
          ticket={editor.mode === "edit" ? editor.ticket : null}
          onClose={() => setEditor({ mode: "closed" })}
        />
      ) : null}

      {workspace.tickets.length === 0 ? (
        <p className="border-t py-6 text-sm text-muted-foreground">No shop tickets on this project yet.</p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Ticket</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Pay application</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {workspace.tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b">
                  <td className="py-2 pr-3 font-mono">{ticket.ticketNumber}</td>
                  <td className="py-2 pr-3">{formatDate(ticket.ticketDate)}</td>
                  <td className="py-2 pr-3">{payApplicationLabel(ticket.payApplicationNumber, ticket.payApplicationMonth) ?? "Not chosen"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatCents(ticket.totalCents)}</td>
                  <td className="py-2 pr-3">
                    <span className={cn("font-medium", STATUS_CLASS[ticket.status])}>{STATUS_LABEL[ticket.status]}</span>
                    {ticket.status === "void" && ticket.voidReason ? (
                      <span className="ml-2 text-muted-foreground">{ticket.voidReason}</span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      {ticket.status !== "draft" ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/print/projects/${projectId}/shop-ticket?ticketId=${ticket.id}`} target="_blank">
                            <IconPrinter className="size-4" />
                            Print
                          </Link>
                        </Button>
                      ) : null}
                      {workspace.canEdit && ticket.status === "draft" ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditor({ mode: "edit", ticket })}>
                          Open
                        </Button>
                      ) : null}
                      {workspace.canEdit && ticket.status === "issued" ? (
                        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setVoiding(ticket)}>
                          Void…
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={voiding !== null} onOpenChange={(open) => (open ? null : setVoiding(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void {voiding?.ticketNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              The ticket keeps its number and stays on the project marked Void. Its PDF in Drive is reprinted with VOID across it,
              and its hours can be billed on a new ticket.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="shop-ticket-void-reason">Reason</Label>
            <Textarea
              id="shop-ticket-void-reason"
              rows={2}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Wrong cost code; replaced by a new ticket"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep ticket</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || voidReason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault()
                confirmVoid()
              }}
            >
              Void ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
