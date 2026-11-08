"use client"

import * as React from "react"
import { IconLock } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import {
  deleteTradeLetter,
  getTradeLetterBoard,
  type TradeLetterBoard,
  type TradeLetterRow,
  type TradeLetterSummary,
} from "@/app/actions/trade-letters"
import { VendorTradeDocsDialog } from "@/components/financials/vendor-trade-docs-dialog"
import { TradeLetterDialog, type TradeLetterDialogTarget } from "@/components/projects/trade-letter-dialog"
import {
  TradeOrdersCell,
  TradePurchaseOrderButton,
  useTradePurchaseOrderSetup,
  type TradePurchaseOrderSetup,
} from "@/components/projects/trade-purchase-orders"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TRADE_LETTER_KIND_LABELS, TRADE_LETTER_STATUS_LABELS, longDate, tradeLetterAvailability } from "@/lib/trade-letters/letter"
import { formatCents as money, formatDate } from "@/lib/format"

/** Letter timestamps as "Oct 30"; nothing when the step hasn't happened. */
function letterDate(iso: string | null): string {
  return formatDate(iso, "short", "")
}

function letterLine(letter: TradeLetterSummary): string {
  const when = letter.status === "signed" ? letterDate(letter.signedAt) : letter.status === "sent" ? letterDate(letter.sentAt) : letterDate(letter.createdAt)
  return `${TRADE_LETTER_KIND_LABELS[letter.kind]} ${letter.letterNumber} · ${TRADE_LETTER_STATUS_LABELS[letter.status]}${when ? ` ${when}` : ""}`
}

function DocsCell({ row, onOpen }: { readonly row: TradeLetterRow; readonly onOpen: () => void }): React.ReactElement {
  if (row.route === "none") return <span className="text-xs text-muted-foreground">Not needed</span>
  if (!row.vendor || !row.docs) {
    return <span className="text-xs text-muted-foreground">Not in the vendor directory, so Compass can&apos;t check their docs.</span>
  }
  const { docs } = row
  const complete = docs.owed.length === 0
  return (
    <div className="grid justify-items-start gap-1">
      <Badge variant={complete ? "secondary" : "destructive"}>
        {docs.requiredCount === 0 ? "None required" : `${docs.goodCount} of ${docs.requiredCount} on file`}
      </Badge>
      {docs.owed.length > 0 && <span className="text-xs text-muted-foreground">Owed: {docs.owed.map((item) => item.label).join(", ")}</span>}
      {docs.expiring.length > 0 && <span className="text-xs text-muted-foreground">Expiring soon: {docs.expiring.join(", ")}</span>}
      <button type="button" className="text-xs underline" onClick={onOpen}>
        {complete ? "Trade docs" : "Trade docs and request"}
      </button>
    </div>
  )
}

function LetterCell({
  projectId,
  row,
  canEdit,
  onEdit,
  onDelete,
}: {
  readonly projectId: string
  readonly row: TradeLetterRow
  readonly canEdit: boolean
  readonly onEdit: (letter: TradeLetterSummary) => void
  readonly onDelete: (letter: TradeLetterSummary) => void
}): React.ReactElement {
  if (row.route === "none") return <span className="text-xs text-muted-foreground">In the owner contract</span>
  if (row.route === "purchase_order") return <TradeOrdersCell projectId={projectId} row={row} />
  if (row.letters.length === 0) return <span className="text-xs text-muted-foreground">Not sent</span>
  return (
    <ul className="grid gap-2">
      {row.letters.map((letter) => (
        <li key={letter.id} className="grid gap-0.5 text-xs">
          <span className="font-medium">{letterLine(letter)}</span>
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <a className="underline" href={`/api/projects/${projectId}/trade-letters/${letter.id}/pdf`} target="_blank" rel="noreferrer">
              Print preview
            </a>
            {letter.signedUrl && (
              <a className="underline" href={letter.signedUrl} target="_blank" rel="noreferrer">
                Signed copy
              </a>
            )}
            {letter.embeddedSessionUrl && (
              <a className="underline" href={letter.embeddedSessionUrl} target="_blank" rel="noreferrer">
                Finish sending in Foxit
              </a>
            )}
            {canEdit && (letter.status === "draft" || letter.status === "preparing") && (
              <button type="button" className="underline" onClick={() => onEdit(letter)}>
                Edit
              </button>
            )}
            {canEdit && (
              <button type="button" className="text-destructive underline" onClick={() => onDelete(letter)}>
                Delete
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

const tradeRowId = (row: TradeLetterRow): string => row.trade.rfqId

function tradeSearchText(row: TradeLetterRow): string {
  return [row.trade.vendor, row.vendor?.category, row.trade.rfqNumber, ...row.trade.codes.map((code) => `${code.costCode ?? ""} ${code.description}`)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

type TradeLetterColumnActions = {
  readonly projectId: string
  readonly canEdit: boolean
  readonly ownerSigned: boolean
  readonly poSetup: TradePurchaseOrderSetup | null
  readonly onOpenDocs: (vendor: { readonly id: string; readonly name: string }) => void
  readonly onCompose: (target: TradeLetterDialogTarget) => void
  readonly onDelete: (letter: TradeLetterSummary) => void
  readonly onReload: () => void
}

export function tradeLetterColumns(actions: TradeLetterColumnActions): ColumnDef<TradeLetterRow>[] {
  const { projectId, canEdit, ownerSigned, poSetup, onOpenDocs, onCompose, onDelete, onReload } = actions
  return [
    {
      id: "trade",
      accessorFn: (row) => row.trade.vendor,
      header: "Trade",
      size: 240,
      cell: ({ row: { original: row } }) => (
        <div>
          <span className="font-medium">{row.trade.vendor}</span>
          {row.trade.ownerScope && <Badge variant="outline" className="ml-2">Owner scope</Badge>}
          <p className="text-xs text-muted-foreground">
            {[row.vendor?.category, row.trade.rfqNumber].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            Accepted {row.trade.acceptedAt ? longDate(row.trade.acceptedAt.slice(0, 10)) : ""}
            {row.trade.acceptedByName ? ` · ${row.trade.acceptedByName}` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "costCodes",
      accessorFn: (row) => row.trade.codes[0]?.costCode ?? undefined,
      header: "Cost codes",
      size: 200,
      cell: ({ row: { original: row } }) => (
        <div className="text-xs">
          {row.trade.codes.map((code, index) => (
            <div key={`${code.costCode ?? ""}-${index}`}>
              {code.costCode ?? ""} {code.description}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "accepted",
      accessorFn: (row) => row.trade.totalCents,
      header: "Accepted",
      size: 120,
      cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.trade.totalCents)}</span>,
    },
    {
      id: "tradeDocs",
      header: "Trade docs",
      enableSorting: false,
      size: 180,
      cell: ({ row: { original: row } }) => (
        <DocsCell row={row} onOpen={() => row.vendor && onOpenDocs({ id: row.vendor.id, name: row.vendor.name })} />
      ),
    },
    {
      id: "letters",
      header: "Letters and POs",
      enableSorting: false,
      size: 240,
      cell: ({ row: { original: row } }) => (
        <LetterCell
          projectId={projectId}
          row={row}
          canEdit={canEdit}
          onEdit={(letter) => onCompose({ row, kind: letter.kind, letterId: letter.id })}
          onDelete={onDelete}
        />
      ),
    },
    {
      id: "actions",
      header: "Next step",
      enableSorting: false,
      size: 200,
      cell: ({ row: { original: row } }) => {
        const award = tradeLetterAvailability("award", ownerSigned)
        const intent = tradeLetterAvailability("intent", ownerSigned)
        const hasSignedAward = row.letters.some((letter) => letter.kind === "award" && letter.status === "signed")
        return (
          <div className="text-right">
            {row.route === "purchase_order" && canEdit && poSetup && (
              <TradePurchaseOrderButton projectId={projectId} row={row} setup={poSetup} onCreated={onReload} />
            )}
            {row.route === "letter" && canEdit && !hasSignedAward && (
              <div className="flex flex-wrap justify-end gap-2">
                {intent.allowed && (
                  <Button type="button" size="sm" variant="outline" onClick={() => onCompose({ row, kind: "intent", letterId: null })}>
                    Letter of intent
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={award.allowed ? "default" : "outline"}
                  disabled={!award.allowed}
                  title={award.allowed ? undefined : award.reason}
                  onClick={() => onCompose({ row, kind: "award", letterId: null })}
                >
                  Award letter
                </Button>
              </div>
            )}
          </div>
        )
      },
    },
  ]
}

/**
 * Everyone whose bid was accepted into this estimate, with their trade docs
 * and the letters sent to them. Award letters unlock once the owner signs;
 * until then a letter of intent holds the trade's place.
 */
export function TradeLettersSection({ projectId, estimateId, refreshKey }: { readonly projectId: string; readonly estimateId: string; readonly refreshKey: number }): React.ReactElement | null {
  const [board, setBoard] = React.useState<TradeLetterBoard | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [composer, setComposer] = React.useState<TradeLetterDialogTarget | null>(null)
  const [docsVendor, setDocsVendor] = React.useState<{ readonly id: string; readonly name: string } | null>(null)
  const [removing, setRemoving] = React.useState<TradeLetterSummary | null>(null)
  const [pending, startTransition] = React.useTransition()
  const hasSuppliers = board?.canEdit === true && board.rows.some((row) => row.route === "purchase_order")
  const poSetup = useTradePurchaseOrderSetup(projectId, hasSuppliers)
  const [query, setQuery] = React.useState("")

  const load = React.useCallback(async () => {
    const result = await getTradeLetterBoard(projectId, estimateId)
    if (result.success) {
      setBoard(result.data)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [projectId, estimateId])

  React.useEffect(() => {
    void load()
  }, [load, refreshKey])

  const rows = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    const all = board?.rows ?? []
    return term === "" ? all : all.filter((row) => tradeSearchText(row).includes(term))
  }, [board, query])
  const canEdit = board?.canEdit === true
  const ownerSigned = board?.ownerSigned === true
  const columns = React.useMemo(
    () => tradeLetterColumns({
      projectId,
      canEdit,
      ownerSigned,
      poSetup,
      onOpenDocs: (vendor) => setDocsVendor(vendor),
      onCompose: setComposer,
      onDelete: setRemoving,
      onReload: () => void load(),
    }),
    [projectId, canEdit, ownerSigned, poSetup, load],
  )
  const table = useRecordTable({ data: rows, columns, getRowId: tradeRowId, resetKey: query, sheetId: "trade-letters.estimate" })

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!board || board.rows.length === 0) return null

  const selected = board.rows.filter((row) => !row.trade.ownerScope)
  const total = selected.reduce((sum, row) => sum + row.trade.totalCents, 0)
  const letterRows = board.rows.filter((row) => row.route === "letter")

  function confirmDelete(): void {
    const letter = removing
    if (!letter) return
    startTransition(async () => {
      const result = await deleteTradeLetter(projectId, letter.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${letter.letterNumber} deleted`)
      setRemoving(null)
      await load()
    })
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Selected trades</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selected.length} selected · {money(total)}
        </span>
      </div>

      {letterRows.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          {!board.ownerSigned && <IconLock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <div className="grid gap-0.5">
            <span className="font-medium">{board.ownerSigned ? "Award letters are open" : "Award letters unlock when the owner signs"}</span>
            <span className="text-muted-foreground">
              {board.ownerStatus}{" "}
              {board.ownerSigned
                ? "A trade who signed a letter of intent gets the award letter as the follow-up."
                : "Until then, send a letter of intent to hold a trade's place."}
            </span>
          </div>
        </div>
      )}

      {board.rows.length > 10 && (
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search selected trades"
          placeholder="Search trade, RFQ or cost code…"
          className="sm:max-w-xs"
        />
      )}
      <RecordTable
        table={table}
        itemLabel="selected trades"
        emptyMessage="No selected trades match this search."
        rowIdPrefix="selected-trade"
      />
      <p className="text-xs text-muted-foreground">
        Missing documents don&apos;t block a letter: it lists what&apos;s still owed, and no payment is made until they&apos;re in.
        Suppliers get one or more purchase orders against their accepted price.
      </p>

      {composer && (
        <TradeLetterDialog
          projectId={projectId}
          estimateId={estimateId}
          target={composer}
          agreementFormSet={board.agreementFormSet}
          agreementDocTypeId={board.agreementDocTypeId}
          onOpenChange={(next) => {
            if (!next) setComposer(null)
          }}
          onSaved={() => void load()}
        />
      )}
      {docsVendor && (
        <VendorTradeDocsDialog
          vendorId={docsVendor.id}
          vendorName={docsVendor.name}
          open
          onOpenChange={(next) => {
            if (!next) setDocsVendor(null)
          }}
          onChanged={() => void load()}
        />
      )}
      <AlertDialog open={removing !== null} onOpenChange={(next) => { if (!next) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removing?.letterNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.status === "signed"
                ? "This letter is signed. Deleting it removes it from Compass only; the signed copy stays in the vendor's Drive folder and in Foxit."
                : removing?.status === "sent"
                  ? "This letter is out for signature. Deleting it here doesn't stop it: cancel it in Foxit too."
                  : "The draft is removed. You can write a new letter any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); confirmDelete() }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
