"use client"

import * as React from "react"

import { submitRfqQuoteByLink } from "@/app/actions/rfq-quote-link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { QuoteLinkView } from "@/lib/rfqs/quote-link-server"

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function longDate(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

/** The vendor's side of a no-login price link: one price per scope line, or decline. */
export function QuoteLinkForm({ token, view }: { readonly token: string; readonly view: QuoteLinkView }): React.ReactElement {
  const previous = view.answer
  const [prices, setPrices] = React.useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(view.scopeItems.map((item) => [item.lineNumber, String(previous?.lines.find((line) => line.lineNumber === item.lineNumber)?.amount ?? "")])),
  )
  const [lineNotes, setLineNotes] = React.useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(view.scopeItems.map((item) => [item.lineNumber, previous?.lines.find((line) => line.lineNumber === item.lineNumber)?.notes ?? ""])),
  )
  const [total, setTotal] = React.useState(previous?.amount !== null && previous?.amount !== undefined ? String(previous.amount) : "")
  const [leadTime, setLeadTime] = React.useState(previous?.leadTime ?? "")
  const [validUntil, setValidUntil] = React.useState(previous?.validUntil ?? "")
  const [notes, setNotes] = React.useState(previous?.notes ?? "")
  const [name, setName] = React.useState("")
  const [company, setCompany] = React.useState(previous?.responderCompany ?? view.requestedFrom ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<"quote" | "decline" | null>(null)
  const [pending, startTransition] = React.useTransition()

  const hasLines = view.scopeItems.length > 0
  const lineTotal = view.scopeItems.reduce((sum, item) => sum + (parseMoney(prices[item.lineNumber] ?? "") ?? 0), 0)

  function submit(decision: "quote" | "decline"): void {
    setError(null)
    if (!name.trim()) {
      setError("Enter your name.")
      return
    }
    startTransition(async () => {
      const result = await submitRfqQuoteByLink(token, {
        decision,
        amount: hasLines ? null : parseMoney(total),
        lines: view.scopeItems.map((item) => ({ lineNumber: item.lineNumber, amount: parseMoney(prices[item.lineNumber] ?? ""), notes: lineNotes[item.lineNumber] || null })),
        leadTime: leadTime || null,
        validUntil: validUntil || null,
        notes: notes || null,
        responderName: name,
        responderCompany: company || null,
      })
      if (result.success) setDone(decision)
      else setError(result.error)
    })
  }

  const header = (
    <div className="grid gap-1">
      <p className="text-sm text-muted-foreground">{view.companyName} · Request for quote {view.rfqNumber ?? ""}</p>
      <h1 className="text-2xl font-semibold text-balance">{view.title}</h1>
      <p className="text-sm">{view.projectLabel}</p>
      <p className="text-sm text-muted-foreground">
        {view.requestedFrom ? `For ${view.requestedFrom}` : null}
        {view.requestedFrom && view.dueDate ? " · " : null}
        {view.dueDate ? `Quote due ${longDate(view.dueDate)}` : null}
      </p>
    </div>
  )

  if (done) {
    return (
      <div className="grid gap-4 rounded-lg border bg-card p-6">
        {header}
        <p className="font-medium">{done === "quote" ? "Thanks, your prices were sent." : "Thanks for letting us know."}</p>
        <p className="text-sm text-muted-foreground">
          {view.companyName} has been notified. You can come back to this link to change your prices until {longDate(view.expiresAt)}, as long as the RFQ is still open.
        </p>
      </div>
    )
  }

  return (
    <form
      className="grid gap-6 rounded-lg border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault()
        submit("quote")
      }}
    >
      {header}
      {view.scope && <p className="whitespace-pre-line text-sm">{view.scope}</p>}

      {view.documentLinks.length > 0 && (
        <div className="grid gap-1">
          <h2 className="text-sm font-semibold">Plans and specifications</h2>
          <ul className="list-disc pl-5 text-sm">
            {view.documentLinks.map((document) => (
              <li key={`${document.lineNumber}-${document.url}`}>
                <a href={document.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{document.label}</a>
                {document.notes ? ` · ${document.notes}` : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {previous && view.state === "open" && (
        <p className="border-l-2 border-primary pl-3 text-sm">
          You answered on {longDate(previous.submittedAt)}. Change anything below and send again to update it.
        </p>
      )}

      {view.state === "closed" ? (
        <p className="text-sm">This RFQ isn&apos;t taking prices anymore. Reply to the RFQ email if something has changed.</p>
      ) : (
        <>
          {hasLines ? (
            <div className="grid gap-3">
              <h2 className="text-sm font-semibold">Your price for each item</h2>
              <div className="divide-y border-y">
                {view.scopeItems.map((item) => (
                  <div key={item.lineNumber} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.costCode ? `${item.costCode} · ` : ""}{item.description}</p>
                      {item.notes && <p className="whitespace-pre-line text-xs text-muted-foreground">{item.notes}</p>}
                      <Input
                        aria-label={`Notes for ${item.description}`}
                        className="mt-2 h-8"
                        placeholder="Notes (optional)"
                        value={lineNotes[item.lineNumber] ?? ""}
                        maxLength={2000}
                        onChange={(event) => setLineNotes({ ...lineNotes, [item.lineNumber]: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`price-${item.lineNumber}`} className="text-xs text-muted-foreground">Price</Label>
                      <Input
                        id={`price-${item.lineNumber}`}
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        placeholder="$0.00"
                        value={prices[item.lineNumber] ?? ""}
                        onChange={(event) => setPrices({ ...prices, [item.lineNumber]: event.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-right text-sm font-semibold tabular-nums">Total {money(lineTotal)}</p>
            </div>
          ) : (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="quoteTotal">Your total price</Label>
              <Input id="quoteTotal" inputMode="decimal" className="tabular-nums" value={total} onChange={(event) => setTotal(event.target.value)} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="quoteLeadTime">Lead time</Label>
              <Input id="quoteLeadTime" value={leadTime} maxLength={240} placeholder="e.g. 3 weeks to start" onChange={(event) => setLeadTime(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="quoteValidUntil">Price good until</Label>
              <Input id="quoteValidUntil" type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quoteNotes">What&apos;s included and excluded</Label>
            <Textarea id="quoteNotes" value={notes} maxLength={10000} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="quoteName">Your name</Label>
              <Input id="quoteName" autoComplete="name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="quoteCompany">Company</Label>
              <Input id="quoteCompany" autoComplete="organization" value={company} maxLength={160} onChange={(event) => setCompany(event.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Sending…" : previous ? "Send updated prices" : "Send prices"}</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit("decline")}>
              We won&apos;t be quoting
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This private link works until {longDate(view.expiresAt)}. To send a quote document instead, reply to the RFQ email with it attached.
          </p>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {view.companyName}
        {view.companyContactLines.length > 0 ? ` · ${view.companyContactLines.join(" · ")}` : ""}
      </p>
    </form>
  )
}
