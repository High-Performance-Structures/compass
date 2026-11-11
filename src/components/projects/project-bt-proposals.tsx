"use client"

/*
 * Buildertrend proposals on a job's Estimate page: read-only, staff-only
 * history below the Compass estimates. A sheet of the job's proposals
 * (newest first, every column sorts) opens each one in the record drawer,
 * which can copy it into a new draft estimate or open its Print Preview.
 * The page hides this section when the job has no proposals.
 */

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconCopy, IconPrinter } from "@tabler/icons-react"
import { toast } from "sonner"

import { copyBtProposalToDraftEstimate } from "@/app/actions/project-bt-proposals"
import { BtProposalDetails } from "@/components/projects/bt-proposal-details"
import { RecordDrawer, useRecordDrawerItem } from "@/components/record-drawer"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { SourceTag } from "@/components/shared/source-tag"
import { Button } from "@/components/ui/button"
import type { BtProposalView } from "@/lib/buildertrend/lead-proposals-server"
import { formatCents, formatDate } from "@/lib/format"
import { printPreviewHref } from "@/lib/print/print-documents"

export function btProposalColumns(onOpen: (proposal: BtProposalView) => void): ColumnDef<BtProposalView>[] {
  return [
    {
      id: "title",
      accessorFn: (row) => row.title,
      header: "Proposal",
      size: 320,
      cell: ({ row: { original: proposal } }) => (
        <span className="inline-flex items-baseline gap-1.5">
          <SourceTag source="buildertrend" />
          <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen(proposal)}>
            {proposal.title}
          </button>
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.statusLabel,
      header: "Status",
      size: 220,
      cell: ({ row }) => row.original.statusLabel,
    },
    {
      id: "addedBy",
      accessorFn: (row) => row.addedByName ?? undefined,
      header: "Added by",
      size: 160,
      cell: ({ row }) => row.original.addedByName ?? "",
    },
    {
      id: "date",
      accessorFn: (row) => row.date ?? undefined,
      header: "Date",
      size: 120,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.date ? formatDate(row.original.date) : ""}</span>,
    },
    {
      id: "amount",
      accessorFn: (row) => row.ownerTotalCents,
      header: "Owner price",
      size: 130,
      cell: ({ row }) => <span className="block text-right tabular-nums">{formatCents(row.original.ownerTotalCents)}</span>,
    },
  ]
}

const proposalId = (proposal: BtProposalView): string => proposal.id

export function ProjectBtProposals({
  projectId,
  proposals,
  canCopy,
  initialItemId,
}: {
  readonly projectId: string
  readonly proposals: readonly BtProposalView[]
  readonly canCopy: boolean
  readonly initialItemId: string | null
}): React.ReactElement {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [openId, open, close] = useRecordDrawerItem(
    initialItemId && proposals.some((proposal) => proposal.id === initialItemId) ? initialItemId : null,
  )
  const [pending, startTransition] = React.useTransition()
  const opened = proposals.find((proposal) => proposal.id === openId) ?? null

  const visible = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return proposals
    return proposals.filter((proposal) =>
      `${proposal.title} ${proposal.statusLabel} ${proposal.addedByName ?? ""}`.toLowerCase().includes(term),
    )
  }, [proposals, query])
  const columns = React.useMemo(() => btProposalColumns((proposal) => open(proposal.id)), [open])
  const table = useRecordTable({ data: visible, columns, getRowId: proposalId, resetKey: query, sheetId: "bt-proposals.estimate" })

  function copyToDraft(proposal: BtProposalView): void {
    startTransition(async () => {
      const result = await copyBtProposalToDraftEstimate(projectId, proposal.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Draft estimate ${result.estimateNumber} started with ${result.lineCount} ${result.lineCount === 1 ? "item" : "items"}.`)
      close()
      router.push(`/dashboard/projects/${projectId}/estimate?estimateId=${encodeURIComponent(result.estimateId)}`)
    })
  }

  return (
    <section aria-labelledby="bt-proposals-heading" className="mt-8 grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bt-proposals-heading" className="text-base font-semibold">
          Buildertrend proposals ({proposals.length})
        </h2>
        <span className="text-xs text-muted-foreground">Staff only</span>
      </div>
      {proposals.length > 5 ? (
        <RecordSearchInput value={query} onChange={setQuery} label="Search Buildertrend proposals" placeholder="Search proposal, status or author…" className="sm:max-w-xs" />
      ) : null}
      <RecordTable
        table={table}
        itemLabel="proposals"
        emptyMessage="No proposals match this search."
        rowIdPrefix="bt-proposal"
        onRowOpen={(proposal) => open(proposal.id)}
      />
      <RecordDrawer
        open={opened !== null}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        eyebrow={opened ? <SourceTag source="buildertrend" /> : null}
        title={opened?.title ?? "Proposal"}
        description={opened ? `${opened.statusLabel} · ${formatCents(opened.ownerTotalCents)}` : undefined}
        footer={
          opened ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={printPreviewHref({ projectId, document: "bt-proposal", params: { proposalId: opened.id }, number: opened.title })}
                  target="_blank"
                >
                  <IconPrinter className="size-4" aria-hidden />
                  Print Preview
                </Link>
              </Button>
              {canCopy ? (
                <Button type="button" size="sm" disabled={pending} onClick={() => copyToDraft(opened)}>
                  <IconCopy className="size-4" aria-hidden />
                  {pending ? "Copying…" : "Copy into a new draft estimate"}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {opened ? <BtProposalDetails proposal={opened} /> : null}
      </RecordDrawer>
    </section>
  )
}
