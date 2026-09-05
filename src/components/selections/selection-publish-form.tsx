"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import {
  publishSelectionDecision,
  type PublishSelectionInput,
} from "@/app/actions/selection-decisions"
import type {
  SelectionDecisionItem,
  SelectionWorkspace,
} from "@/lib/selections/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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

export function SelectionPublishForm({
  item,
  workspace,
}: {
  readonly item: SelectionDecisionItem
  readonly workspace: SelectionWorkspace
}): React.ReactElement {
  const router = useRouter(),
    [error, setError] = React.useState<string | null>(null),
    [confirmation, setConfirmation] =
      React.useState<PublishSelectionInput | null>(null),
    [pending, start] = React.useTransition()
  const { register, handleSubmit } = useForm<PublishSelectionInput>({
    defaultValues: {
      selectionId: item.id,
      expectedRevision: item.revision,
      selectionUpdatedAt: item.selectionUpdatedAt,
      published: item.published,
      decisionDueDate: item.decisionDueDate ?? "",
      allowance:
        item.allowanceCents === null
          ? ""
          : (item.allowanceCents / 100).toFixed(2),
      price:
        item.quotedCents === null ? "" : (item.quotedCents / 100).toFixed(2),
      scheduleImpact: item.scheduleImpact ?? "",
      ownerNote: item.ownerNote ?? "",
      requiresChangeOrder: item.requiresChangeOrder,
      changeOrderId: item.changeOrderId ?? "",
    },
  })
  function save(values: PublishSelectionInput): void {
    start(async () => {
      setError(null)
      const result = await publishSelectionDecision(workspace.projectId, values)
      if (!result.success) setError(result.error)
      else router.refresh()
    })
  }
  return (
    <details className="mt-3 border-t pt-3">
      <summary className="cursor-pointer text-sm font-medium text-primary">
        Publish decision / pricing
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={handleSubmit((values) =>
          item.approvedAt ? setConfirmation(values) : save(values)
        )}
      >
        <p className="text-xs text-muted-foreground">
          Publishes the current staff specification shown below as a new
          revision. Use the existing Finish Selections editor to change the
          product first.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Decision deadline
            <Input type="date" {...register("decisionDueDate")} />
          </label>
          <label className="grid gap-1 text-sm">
            Allowance / included amount ($)
            <Input
              inputMode="decimal"
              {...register("allowance")}
              placeholder="Pending"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Total price to owner ($)
            <Input
              inputMode="decimal"
              {...register("price")}
              placeholder="Pending"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Related change order
            <select
              className="h-9 min-w-0 rounded-md border bg-background px-2"
              {...register("changeOrderId")}
            >
              <option value="">No change order</option>
              {workspace.changeOrders.map((change) => (
                <option key={change.id} value={change.id}>
                  {change.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          Lead time and schedule impact
          <Textarea
            {...register("scheduleImpact")}
            maxLength={2000}
            placeholder="For example, six-week lead time; no change to completion date."
          />
        </label>
        <label className="grid gap-1 text-sm">
          Note for owner
          <Textarea {...register("ownerNote")} maxLength={4000} />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("requiresChangeOrder")} />
          Requires an approved change order (even when the price is unchanged)
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("published")} />
          Visible in the owner workspace
        </label>
        <p className="text-xs text-muted-foreground">
          Blank pricing remains pending. A price difference requires an approved
          owner change order. Supplier costs and internal notes are never
          published here.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save decision revision"}
        </Button>
      </form>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the approved revision?</AlertDialogTitle>
            <AlertDialogDescription>
              The previous approval remains in the history. The new revision
              will require a fresh owner approval before it is shared as the
              approved specification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmation) save(confirmation)
                setConfirmation(null)
              }}
            >
              Save new revision
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </details>
  )
}
