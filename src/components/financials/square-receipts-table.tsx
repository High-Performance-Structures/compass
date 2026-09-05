"use client"

import Link from "next/link"
import * as React from "react"

import type { SquareReceiptListItem } from "@/app/actions/sage-square-receipts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type SquareReceiptsTableProps = {
  readonly receipts: readonly SquareReceiptListItem[]
  readonly selectedReceiptId: string | null
}

function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function statusLabel(status: string): string {
  if (status === "manual_action_required") return "Awaiting Sage receipt"
  if (status === "queued") return "Queued"
  if (status === "running") return "Processing"
  if (status === "succeeded") return "Posted in Sage"
  if (status === "attention" || status === "failed") return "Needs review"
  return status.replaceAll("_", " ")
}

function statusClass(status: string): string {
  if (status === "attention" || status === "failed") {
    return "text-destructive"
  }
  if (status === "succeeded") return "text-primary"
  return "text-muted-foreground"
}

export function SquareReceiptsTable({
  receipts,
  selectedReceiptId,
}: SquareReceiptsTableProps) {
  React.useEffect(() => {
    if (!selectedReceiptId) return
    window.requestAnimationFrame(() => {
      document
        .getElementById(`square-receipt-${selectedReceiptId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }, [selectedReceiptId])

  return (
    <section className="rounded-lg border">
      <div className="space-y-1 border-b px-4 py-3">
        <h3 className="font-medium">Square receipts</h3>
        <p className="text-sm text-muted-foreground">
          Payments received in Square, matched to an active Compass project,
          and tracked through Sage posting. These do not require a second
          business approval.
        </p>
      </div>
      {receipts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No project-linked Square receipts have been recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project / client</TableHead>
                <TableHead>Sage invoice</TableHead>
                <TableHead>Square payment</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Square fee</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((receipt) => (
                <TableRow
                  id={`square-receipt-${receipt.id}`}
                  key={receipt.id}
                  className={
                    selectedReceiptId === receipt.id ? "bg-accent/50" : undefined
                  }
                >
                  <TableCell>
                    <Link
                      href={`/dashboard/projects/${encodeURIComponent(receipt.projectId)}/financials`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {receipt.projectNumber ?? receipt.sageJobShortName ?? "Project"}
                      {` — ${receipt.projectName}`}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {receipt.clientName ?? "Client not listed"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{receipt.sageInvoiceNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      Record {receipt.sageInvoiceId} · {receipt.department}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">
                      {receipt.squarePaymentId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(receipt.paymentCompletedAt).toLocaleString()}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {dollars(receipt.amountCents)}
                  </TableCell>
                  <TableCell className="text-right">
                    {dollars(receipt.feeCents)}
                    {receipt.feeStatus ? (
                      <div className="text-xs text-muted-foreground">
                        {statusLabel(receipt.feeStatus)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className={statusClass(receipt.receiptStatus)}>
                      {statusLabel(receipt.receiptStatus)}
                    </div>
                    {receipt.errorMessage ? (
                      <div className="max-w-72 text-xs text-destructive">
                        {receipt.errorMessage}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Deposit {receipt.depositAccountNumber}; fees{" "}
                        {receipt.merchantFeeAccountNumber}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
