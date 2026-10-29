"use client"

import * as React from "react"
import { IconLock } from "@tabler/icons-react"
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
import { TRADE_LETTER_KIND_LABELS, TRADE_LETTER_STATUS_LABELS, longDate, tradeLetterAvailability, type TradeLetterKind } from "@/lib/trade-letters/letter"

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function shortDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function letterLine(letter: TradeLetterSummary): string {
  const when = letter.status === "signed" ? shortDate(letter.signedAt) : letter.status === "sent" ? shortDate(letter.sentAt) : shortDate(letter.createdAt)
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
  if (row.route === "purchase_order") return <span className="text-xs text-muted-foreground">Suppliers get purchase orders (coming next)</span>
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

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!board || board.rows.length === 0) return null

  const selected = board.rows.filter((row) => !row.trade.ownerScope)
  const total = selected.reduce((sum, row) => sum + row.trade.totalCents, 0)
  const letterRows = board.rows.filter((row) => row.route === "letter")

  function open(row: TradeLetterRow, kind: TradeLetterKind): void {
    setComposer({ row, kind, letterId: null })
  }

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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Trade</th>
              <th className="py-2 pr-4 font-medium">Cost codes</th>
              <th className="py-2 pr-4 text-right font-medium">Accepted</th>
              <th className="py-2 pr-4 font-medium">Trade docs</th>
              <th className="py-2 pr-4 font-medium">Letters</th>
              <th className="py-2 text-right font-medium">Next step</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => {
              const award = tradeLetterAvailability("award", board.ownerSigned)
              const intent = tradeLetterAvailability("intent", board.ownerSigned)
              const hasSignedAward = row.letters.some((letter) => letter.kind === "award" && letter.status === "signed")
              return (
                <tr key={row.trade.rfqId} className="border-b align-top">
                  <td className="py-3 pr-4">
                    <span className="font-medium">{row.trade.vendor}</span>
                    {row.trade.ownerScope && <Badge variant="outline" className="ml-2">Owner scope</Badge>}
                    <p className="text-xs text-muted-foreground">
                      {[row.vendor?.category, row.trade.rfqNumber].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Accepted {row.trade.acceptedAt ? longDate(row.trade.acceptedAt.slice(0, 10)) : ""}
                      {row.trade.acceptedByName ? ` · ${row.trade.acceptedByName}` : ""}
                    </p>
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    {row.trade.codes.map((code, index) => (
                      <div key={`${code.costCode ?? ""}-${index}`}>
                        {code.costCode ?? ""} {code.description}
                      </div>
                    ))}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{money(row.trade.totalCents)}</td>
                  <td className="py-3 pr-4">
                    <DocsCell row={row} onOpen={() => row.vendor && setDocsVendor({ id: row.vendor.id, name: row.vendor.name })} />
                  </td>
                  <td className="py-3 pr-4">
                    <LetterCell
                      projectId={projectId}
                      row={row}
                      canEdit={board.canEdit}
                      onEdit={(letter) => setComposer({ row, kind: letter.kind, letterId: letter.id })}
                      onDelete={setRemoving}
                    />
                  </td>
                  <td className="py-3 text-right">
                    {row.route === "letter" && board.canEdit && !hasSignedAward && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {intent.allowed && (
                          <Button type="button" size="sm" variant="outline" onClick={() => open(row, "intent")}>
                            Letter of intent
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant={award.allowed ? "default" : "outline"}
                          disabled={!award.allowed}
                          title={award.allowed ? undefined : award.reason}
                          onClick={() => open(row, "award")}
                        >
                          Award letter
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Missing documents don&apos;t block a letter: it lists what&apos;s still owed, and no payment is made until they&apos;re in.
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
