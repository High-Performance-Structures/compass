"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import {
  saveSelectionRequest,
  closeSelectionRequest,
  type SelectionRequestInput,
} from "@/app/actions/selection-requests"
import type {
  SelectionDecisionItem,
  SelectionRequest,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function SelectionRequestForm({
  projectId,
  item,
  request,
  onDone,
}: {
  readonly projectId: string
  readonly item: SelectionDecisionItem
  readonly request: SelectionRequest | null
  readonly onDone: () => void
}): React.ReactElement {
  const router = useRouter(),
    [error, setError] = React.useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SelectionRequestInput>({
    defaultValues: {
      selectionId: item.id,
      revision: item.revision,
      requestId: request?.id ?? null,
      expectedUpdatedAt: request?.updatedAt ?? null,
      kind: request?.kind ?? "pricing",
      note: request?.note ?? "",
      productUrl: request?.productUrl ?? "",
    },
  })
  return (
    <form
      className="mt-3 space-y-3 border-t pt-3"
      onSubmit={handleSubmit(async (values) => {
        setError(null)
        const result = await saveSelectionRequest(projectId, values)
        if (!result.success) {
          setError(result.error)
          return
        }
        router.refresh()
        onDone()
      })}
    >
      <label className="grid gap-1 text-sm">
        Request type
        <select
          className="h-9 rounded-md border bg-background px-2"
          {...register("kind")}
        >
          <option value="pricing">Request pricing</option>
          <option value="alternative">Propose an alternative</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        What are you considering?
        <Textarea
          {...register("note", { required: true, maxLength: 4000 })}
          required
          maxLength={4000}
          placeholder="For example, price this range in place of the current model."
        />
      </label>
      <label className="grid gap-1 text-sm">
        Product link (optional)
        <Input
          {...register("productUrl")}
          type="url"
          placeholder="https://"
          maxLength={2000}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        A request does not authorize a purchase or change an approved selection.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving…" : request ? "Save request" : "Send request"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function SelectionRequestCard({
  projectId,
  item,
  request,
  staff,
}: {
  readonly projectId: string
  readonly item: SelectionDecisionItem
  readonly request: SelectionRequest
  readonly staff: boolean
}): React.ReactElement {
  const router = useRouter(),
    [editing, setEditing] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [pending, start] = React.useTransition()
  const { register, handleSubmit, reset } = useForm<{ response: string }>({
    defaultValues: { response: "" },
  })
  function withdraw(): void {
    start(async () => {
      const result = await closeSelectionRequest(
        projectId,
        request.id,
        request.updatedAt,
        "withdraw",
        ""
      )
      if (!result.success) setError(result.error)
      else router.refresh()
    })
  }
  return (
    <div className="border-l-2 border-primary/30 pl-3 text-sm">
      <p className="font-medium">
        {request.kind === "pricing"
          ? "Pricing request"
          : "Alternative proposed"}{" "}
        · {request.status}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{request.note}</p>
      {request.productUrl && (
        <a
          className="text-primary underline"
          href={request.productUrl}
          target="_blank"
          rel="noreferrer"
        >
          Proposed product ↗
        </a>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {request.requesterName}
      </p>
      {request.response && (
        <p className="mt-2 whitespace-pre-wrap">
          Team response: {request.response}
        </p>
      )}
      {request.canEdit && !editing && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit request
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={pending} size="sm" variant="ghost">
                Withdraw request
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Withdraw this request?</AlertDialogTitle>
                <AlertDialogDescription>
                  The team will no longer need to act on it. Its history is
                  retained, and any approved selection remains unchanged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep request</AlertDialogCancel>
                <AlertDialogAction onClick={withdraw}>
                  Withdraw request
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {editing && (
        <SelectionRequestForm
          projectId={projectId}
          item={item}
          request={request}
          onDone={() => setEditing(false)}
        />
      )}
      {staff && request.status === "open" && (
        <form
          className="mt-3 grid gap-2"
          onSubmit={handleSubmit((values) =>
            start(async () => {
              setError(null)
              const result = await closeSelectionRequest(
                projectId,
                request.id,
                request.updatedAt,
                "resolve",
                values.response
              )
              if (!result.success) setError(result.error)
              else {
                reset()
                router.refresh()
              }
            })
          )}
        >
          <label className="grid gap-1">
            Response to owner
            <Textarea
              {...register("response", { required: true })}
              required
              maxLength={4000}
              placeholder="Explain the price or alternative, and publish revised terms above when needed."
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            className="justify-self-start"
          >
            Resolve request
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
