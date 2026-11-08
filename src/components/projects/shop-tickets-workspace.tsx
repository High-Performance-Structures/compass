"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconEye, IconPlus } from "@tabler/icons-react"
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
import { useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ShopTicketStatus } from "@/db/schema-shop-tickets"
import type { ShopTicketWithLines } from "@/lib/shop-tickets/data"
import { formatCents, payApplicationLabel } from "@/lib/shop-tickets/model"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const STATUS_LABEL: { readonly [K in ShopTicketStatus]: string } = { draft: "Draft", issued: "Issued", void: "Void" }
const STATUS_CLASS: { readonly [K in ShopTicketStatus]: string } = {
  draft: "text-primary",
  issued: "text-success",
  void: "text-destructive line-through",
}

const STATUS_ORDER: readonly ShopTicketStatus[] = ["draft", "issued", "void"]

function printHref(projectId: string, ticket: ShopTicketWithLines): string {
  return `/print/projects/${projectId}/shop-ticket?ticketId=${ticket.id}`
}

/** How a ticket opens: its editor while it is a draft, its Print Preview once issued or void. */
type TicketActions = {
  readonly projectId: string
  readonly canEdit: boolean
  readonly onEdit: (ticket: ShopTicketWithLines) => void
  readonly onVoid: (ticket: ShopTicketWithLines) => void
}

export function shopTicketColumns({ projectId, canEdit, onEdit, onVoid }: TicketActions): ColumnDef<ShopTicketWithLines>[] {
  return [
    {
      id: "ticket",
      accessorFn: (row) => row.ticketNumber,
      header: "Ticket",
      size: 130,
      cell: ({ row: { original: ticket } }) =>
        ticket.status !== "draft" ? (
          <Link href={printHref(projectId, ticket)} target="_blank" className="font-mono hover:underline">
            {ticket.ticketNumber}
          </Link>
        ) : canEdit ? (
          <button type="button" className="font-mono hover:underline" onClick={() => onEdit(ticket)}>
            {ticket.ticketNumber}
          </button>
        ) : (
          <span className="font-mono">{ticket.ticketNumber}</span>
        ),
    },
    {
      id: "date",
      accessorFn: (row) => row.ticketDate.slice(0, 10),
      header: "Date",
      size: 120,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.ticketDate.slice(0, 10), "medium")}</span>,
    },
    {
      id: "payApplication",
      accessorFn: (row) => payApplicationLabel(row.payApplicationNumber, row.payApplicationMonth) ?? undefined,
      header: "Pay application",
      size: 170,
      cell: ({ row }) => payApplicationLabel(row.original.payApplicationNumber, row.original.payApplicationMonth) ?? "Not chosen",
    },
    {
      id: "total",
      accessorFn: (row) => row.totalCents,
      header: "Total",
      size: 120,
      cell: ({ row }) => <span className="block text-right tabular-nums">{formatCents(row.original.totalCents)}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => STATUS_ORDER.indexOf(row.status),
      header: "Status",
      size: 200,
      cell: ({ row: { original: ticket } }) => (
        <>
          <span className={cn("font-medium", STATUS_CLASS[ticket.status])}>{STATUS_LABEL[ticket.status]}</span>
          {ticket.status === "void" && ticket.voidReason ? <span className="ml-2 text-muted-foreground">{ticket.voidReason}</span> : null}
        </>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      size: 200,
      cell: ({ row: { original: ticket } }) => (
        <div className="flex justify-end gap-2">
          {ticket.status !== "draft" ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={printHref(projectId, ticket)} target="_blank">
                <IconEye className="size-4" />
                Print Preview
              </Link>
            </Button>
          ) : null}
          {canEdit && ticket.status === "draft" ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onEdit(ticket)}>
              Open
            </Button>
          ) : null}
          {canEdit && ticket.status === "issued" ? (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onVoid(ticket)}>
              Void…
            </Button>
          ) : null}
        </div>
      ),
    },
  ]
}

const ticketId = (ticket: ShopTicketWithLines): string => ticket.id

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
  const startFilter = useListSheetStartFilter("shop-tickets.job", "all")
  const [chosenFilter, setFilter] = React.useState<string | null>(null)
  const filter = chosenFilter ?? startFilter
  const [query, setQuery] = React.useState("")
  const tickets = workspace.tickets
  const canEdit = workspace.canEdit

  const visibleTickets = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    return tickets.filter((ticket) => {
      // Open is every ticket that still counts: drafts and issued tickets.
      if (filter === "open" && ticket.status === "void") return false
      if (filter !== "open" && filter !== "all" && ticket.status !== filter) return false
      const text = `${ticket.ticketNumber} ${payApplicationLabel(ticket.payApplicationNumber, ticket.payApplicationMonth) ?? ""} ${STATUS_LABEL[ticket.status]} ${ticket.voidReason ?? ""}`
      return term === "" || text.toLowerCase().includes(term)
    })
  }, [tickets, filter, query])

  const filterOptions = React.useMemo(() => [
    { value: "open", label: "Open", count: tickets.filter((ticket) => ticket.status !== "void").length, pinned: true },
    ...STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABEL[status], count: tickets.filter((ticket) => ticket.status === status).length })),
    { value: "all", label: "All", count: tickets.length, pinned: true },
  ], [tickets])

  const columns = React.useMemo(
    () => shopTicketColumns({ projectId, canEdit, onEdit: (ticket) => setEditor({ mode: "edit", ticket }), onVoid: setVoiding }),
    [projectId, canEdit],
  )
  const table = useRecordTable({
    data: visibleTickets,
    columns,
    getRowId: ticketId,
    resetKey: `${filter}:${query}`,
    sheetId: "shop-tickets.job",
  })

  function openTicket(ticket: ShopTicketWithLines): void {
    if (ticket.status !== "draft") window.open(printHref(projectId, ticket), "_blank", "noopener")
    else if (canEdit) setEditor({ mode: "edit", ticket })
  }

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
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusFilterBar
              kind="button"
              label="Filter shop tickets by status"
              options={filterOptions}
              selected={filter}
              onSelect={setFilter}
            />
            <RecordSearchInput
              value={query}
              onChange={setQuery}
              label="Search shop tickets"
              placeholder="Search ticket, pay application or void reason…"
              className="sm:max-w-xs"
            />
          </div>
          <RecordTable
            table={table}
            itemLabel="shop tickets"
            emptyMessage={query ? "No shop tickets match this search." : "No shop tickets in this view."}
            rowIdPrefix="shop-ticket"
            onRowOpen={openTicket}
          />
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
