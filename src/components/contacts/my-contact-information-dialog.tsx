"use client"

import type { MyContactRecord } from "@/app/actions/my-contact-records"
import type { MySageContactProposalStatus } from "@/app/actions/sage-contact-changes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** The signed-in person's own directory records and recent Sage proposals. */
export function MyContactInformationDialog({
  open,
  onOpenChange,
  myContacts,
  myProposalStatuses,
  onProposeEdit,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly myContacts: readonly MyContactRecord[]
  readonly myProposalStatuses: readonly MySageContactProposalStatus[]
  readonly onProposeEdit: (record: MyContactRecord) => void
}): React.ReactElement {
  return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>My contact information</DialogTitle>
        <DialogDescription>Propose a change to your own verified Sage contact record. Another authorized staff member reviews it before Sage is updated.</DialogDescription>
      </DialogHeader>
      {myContacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No directory person is linked to your Compass account yet. Ask an account administrator to verify and link the correct contact record.</p>
      ) : (
        <div className="space-y-2">
          {myContacts.map((record) => (
            <div key={`${record.kind}:${record.entityId}`} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
              <div><div className="font-medium">{record.name}</div><div className="text-muted-foreground">{record.companyName ?? "Internal"}</div></div>
              {record.sageLinked ? (
                <Button type="button" size="sm" variant="outline" onClick={() => onProposeEdit(record)}>Propose edit</Button>
              ) : <Badge variant="outline">Sage link pending</Badge>}
            </div>
          ))}
        </div>
      )}
      {myProposalStatuses.length > 0 ? (
        <div className="space-y-2 border-t pt-3 text-sm">
          <p className="font-medium">Recent proposals</p>
          {myProposalStatuses.map((proposal) => (
            <div key={proposal.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
              <span>{proposal.kind.replaceAll("_", " ")} · {new Date(proposal.requestedAt).toLocaleDateString()}</span>
              <span>{proposal.status}{proposal.errorMessage ? ` · ${proposal.errorMessage}` : ""}</span>
            </div>
          ))}
        </div>
      ) : null}
    </DialogContent>
  </Dialog>
  )
}
