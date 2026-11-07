"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconFileImport, IconLink, IconUnlink } from "@tabler/icons-react"

import {
  attachPayApplicationShopTicket,
  detachPayApplicationShopTicket,
  importPayApplicationShopTickets,
  setPayApplicationShopTicketAlreadyIncluded,
  type PayApplicationShopTickets as Data,
} from "@/app/actions/shop-ticket-billing"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCents } from "@/lib/format"

const STATUS_LABEL = { draft: "Draft", issued: "Issued", void: "Void" } as const

function billingLabel(ticket: Data["tickets"][number]): string {
  if (ticket.status !== "issued") return ticket.importedCents !== 0 ? `${formatCents(ticket.importedCents)} to take off` : "Not billed"
  if (ticket.alreadyIncluded) return "Already included"
  if (ticket.importedCents === 0) return ticket.pendingCents === 0 ? "Nothing to import" : "Not imported"
  return ticket.pendingCents === 0 ? `Imported ${formatCents(ticket.importedCents)}` : `Imported ${formatCents(ticket.importedCents)}, changes pending`
}

/**
 * Shop tickets billed on this pay application. On a draft, staff attach or
 * unlink tickets, import their amounts onto the G703 lines, or mark a ticket
 * as already included by hand.
 */
export function PayApplicationShopTickets({
  projectId,
  applicationId,
  data,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly data: Data
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<readonly string[]>([])
  const [attachId, setAttachId] = useState("")
  const href = `/dashboard/projects/${encodeURIComponent(projectId)}/shop-tickets`
  const pendingCents = data.tickets.reduce((sum, ticket) => sum + Math.abs(ticket.pendingCents), 0)

  function run(action: () => Promise<{ readonly success: boolean; readonly error?: string }>, done: string): void {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      setMessage(result.success ? done : (result.error ?? "Something went wrong."))
      router.refresh()
    })
  }

  function importTickets(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await importPayApplicationShopTickets(projectId, applicationId)
      if (!result.success) {
        setMessage(result.error)
        return
      }
      setWarnings(result.data.warnings)
      setMessage(
        result.data.addedCents === 0
          ? "Shop tickets are up to date on the lines."
          : `${formatCents(result.data.addedCents)} from shop tickets was added to current work.`
      )
      router.refresh()
    })
  }

  const shownWarnings = [...new Set([...warnings, ...data.warnings])]

  return (
    <section aria-labelledby="pay-app-shop-tickets" className="clarity-panel mt-5 grid gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pay-app-shop-tickets" className="font-semibold">
          Shop tickets
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {data.editable && (
            <Button size="sm" onClick={importTickets} disabled={isPending || pendingCents === 0}>
              <IconFileImport className="size-4" />
              Import shop tickets
            </Button>
          )}
          <Link href={href} className="text-sm underline underline-offset-2">
            Open shop tickets
          </Link>
        </div>
      </div>
      {data.editable && (
        <p className="text-xs text-muted-foreground">
          Importing adds each ticket&apos;s amounts on top of the current work on the lines with the same cost code. Importing again adds only what changed.
        </p>
      )}
      {message && <p className="text-sm" role="status">{message}</p>}
      {shownWarnings.length > 0 && (
        <ul className="grid gap-1 text-sm text-warning" aria-label="Shop ticket warnings">
          {shownWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {data.tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shop tickets are billed on this pay application.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Ticket</th>
                <th className="py-2 pr-2 font-medium">Labor dates</th>
                <th className="py-2 pr-2 font-medium">Status</th>
                <th className="py-2 pr-2 font-medium">On this pay request</th>
                <th className="py-2 pr-2 text-right font-medium">Total</th>
                {data.editable && <th className="py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b">
                  <td className="py-2 pr-2 font-medium">{ticket.ticketNumber}</td>
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                    {ticket.laborFrom && ticket.laborTo ? `${ticket.laborFrom} – ${ticket.laborTo}` : ticket.ticketDate}
                  </td>
                  <td className="py-2 pr-2">{STATUS_LABEL[ticket.status]}</td>
                  <td className="py-2 pr-2">{billingLabel(ticket)}</td>
                  <td className={ticket.status === "issued" ? "py-2 pr-2 text-right tabular-nums" : "py-2 pr-2 text-right tabular-nums text-muted-foreground line-through"}>
                    {formatCents(ticket.totalCents)}
                  </td>
                  {data.editable && (
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-3">
                        {ticket.status === "issued" && ticket.importedCents === 0 && (
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={ticket.alreadyIncluded}
                              disabled={isPending}
                              onCheckedChange={(checked) =>
                                run(
                                  () => setPayApplicationShopTicketAlreadyIncluded(projectId, applicationId, ticket.id, checked === true),
                                  checked === true
                                    ? `${ticket.ticketNumber} is marked as already included. No line amounts changed.`
                                    : `${ticket.ticketNumber} can be imported again.`
                                )
                              }
                            />
                            Already included on this pay request
                          </label>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => detachPayApplicationShopTicket(projectId, applicationId, ticket.id),
                              ticket.importedCents !== 0
                                ? `${ticket.ticketNumber} was unlinked and its ${formatCents(ticket.importedCents)} taken off the lines.`
                                : `${ticket.ticketNumber} was unlinked.`
                            )
                          }
                        >
                          <IconUnlink className="size-4" />
                          Unlink
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="py-2 pr-2 text-right font-semibold">
                  Issued total
                </td>
                <td className="py-2 pr-2 text-right font-semibold tabular-nums">{formatCents(data.issuedTotalCents)}</td>
                {data.editable && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {data.editable && data.attachable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={attachId} onValueChange={setAttachId}>
            <SelectTrigger className="w-72" aria-label="Shop ticket to attach">
              <SelectValue placeholder="Choose an issued ticket" />
            </SelectTrigger>
            <SelectContent>
              {data.attachable.map((ticket) => (
                <SelectItem key={ticket.id} value={ticket.id}>
                  {ticket.ticketNumber} · {formatCents(ticket.totalCents)}
                  {ticket.payApplicationNumber !== null ? ` · names pay app ${ticket.payApplicationNumber}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending || !attachId}
            onClick={() => {
              const ticket = data.attachable.find((row) => row.id === attachId)
              setAttachId("")
              run(() => attachPayApplicationShopTicket(projectId, applicationId, attachId), `${ticket?.ticketNumber ?? "The ticket"} was attached.`)
            }}
          >
            <IconLink className="size-4" />
            Attach shop ticket
          </Button>
        </div>
      )}
    </section>
  )
}
