"use client"

import { SearchableCombobox } from "@/components/searchable-combobox"
import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import {
  publishSelectionDecision,
  type PublishSelectionInput,
} from "@/app/actions/selection-decisions"
import type {
  SelectionDecisionItem,
  SelectionWorkspace,
} from "@/lib/selections/types"
import { selectionPublicationInput } from "@/lib/selections/publication"
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

const NO_CHANGE_ORDER = "__no_change_order__"

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
  const { register, control, handleSubmit, watch } = useForm<PublishSelectionInput>({
    defaultValues: selectionPublicationInput(item),
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
    <section className="mt-3 border-t pt-3" aria-label="Owner publication">
      <h3 className="text-sm font-semibold">Publish to owner</h3>
      <form
        className="mt-3 space-y-3"
        onSubmit={handleSubmit((values) =>
          item.approvedAt ? setConfirmation(values) : save(values)
        )}
      >
        <p className="text-xs text-muted-foreground">
          Share a pending choice for an owner decision or an already-selected
          item for reference. Publishing does not record owner approval.
          To change the product, use Edit finish specifications below first.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("published")} />
          Visible in the owner workspace
        </label>
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
            <Controller
              control={control}
              name="changeOrderId"
              render={({ field }) => (
                <SearchableCombobox
                  className="h-9 min-w-0 text-sm"
                  // "" means no change order; the picker needs a non-empty value for it.
                  value={field.value ? field.value : NO_CHANGE_ORDER}
                  onValueChange={(value) =>
                    field.onChange(value === NO_CHANGE_ORDER || value === "" ? "" : value)
                  }
                  options={[
                    { value: NO_CHANGE_ORDER, label: "No change order" },
                    ...workspace.changeOrders.map((change) => ({
                      value: change.id,
                      label: change.label,
                    })),
                  ]}
                  ariaLabel="Related change order"
                  placeholder="No change order"
                  searchPlaceholder="Search change orders..."
                  emptyMessage="No matching change orders."
                />
              )}
            />
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
          {pending ? "Saving…" : !watch("published") ? "Save as internal draft" : item.published ? "Update owner view" : "Publish to owner"}
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
    </section>
  )
}
