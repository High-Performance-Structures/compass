"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconExternalLink } from "@tabler/icons-react"
import { toast } from "sonner"

import { replaceExecutedProjectChangeOrderDocument } from "@/app/actions/project-change-orders"
import { uploadChangeOrderDocuments } from "@/components/projects/project-change-order-document-upload"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ProjectChangeOrderExecutedDocument({
  projectId,
  changeOrderId,
  available,
  label,
  canManage,
}: {
  readonly projectId: string
  readonly changeOrderId: string
  readonly available: boolean
  readonly label: string | null
  readonly canManage: boolean
}): React.ReactElement {
  const router = useRouter()
  const [file, setFile] = React.useState<File | null>(null)
  const [url, setUrl] = React.useState("")
  const [documentLabel, setDocumentLabel] = React.useState(label ?? "")
  const [reason, setReason] = React.useState("")
  const [attested, setAttested] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const documentHref = `/api/projects/${projectId}/change-orders/${changeOrderId}/executed-document`

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      try {
        let nextUrl = url.trim()
        let nextLabel = documentLabel.trim()
        if (file) {
          if (
            file.type !== "application/pdf" &&
            !file.name.toLowerCase().endsWith(".pdf")
          ) {
            throw new Error("The executed change order must be a PDF.")
          }
          if (file.size > 50 * 1024 * 1024) {
            throw new Error("The executed change-order PDF must be 50 MB or smaller.")
          }
          const [uploaded] = await uploadChangeOrderDocuments([file], projectId)
          if (!uploaded) throw new Error("The executed PDF did not upload.")
          nextUrl = uploaded.url
          nextLabel = nextLabel || uploaded.label
        }
        const result = await replaceExecutedProjectChangeOrderDocument(
          projectId,
          changeOrderId,
          {
            url: nextUrl,
            label: nextLabel,
            reason,
            attested,
          }
        )
        if (!result.success) throw new Error(result.error)
        toast.success(
          available
            ? "Active executed change-order document replaced."
            : "Executed change-order document published to the owner."
        )
        setFile(null)
        setUrl("")
        setReason("")
        setAttested(false)
        router.refresh()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not update the executed change-order document."
        )
      }
    })
  }

  return (
    <section className="border-y bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Executed change-order document</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {available
              ? label ?? "The authoritative fully executed change order."
              : "No authoritative executed document has been recorded yet."}
          </p>
        </div>
        {available && (
          <Button asChild size="sm" variant="outline">
            <Link href={documentHref} target="_blank">
              <IconExternalLink className="size-4" />Open executed change order
            </Link>
          </Button>
        )}
      </div>

      {canManage && (
        <form className="mt-4 space-y-4 border-t pt-4" onSubmit={submit}>
          <p className="text-xs text-muted-foreground">
            {available
              ? "Replace only with another presentation copy of the same signed change order. Compass preserves the prior label and reason in activity history."
              : "Add the complete signed PDF for this historical executed change order."}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="change-order-executed-replacement-file">
                Upload executed PDF
              </Label>
              <Input
                id="change-order-executed-replacement-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">PDF, 50 MB maximum.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="change-order-executed-replacement-url">
                Or secure saved-document link
              </Label>
              <Input
                id="change-order-executed-replacement-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://drive.google.com/..."
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="change-order-executed-replacement-label">
                Document label
              </Label>
              <Input
                id="change-order-executed-replacement-label"
                value={documentLabel}
                onChange={(event) => setDocumentLabel(event.target.value)}
                placeholder="Executed change order.pdf"
                maxLength={200}
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="change-order-executed-replacement-reason">
                {available ? "Replacement reason" : "Reason for adding after execution"}
              </Label>
              <Input
                id="change-order-executed-replacement-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  available
                    ? "Corrected presentation copy; signed terms are unchanged."
                    : "Added the archived fully signed change order."
                }
                maxLength={1000}
                required
                disabled={pending}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={attested}
              onCheckedChange={(checked) => setAttested(checked === true)}
              disabled={pending}
            />
            <span>
              I confirm this is the same complete, fully executed change order and
              that no signed terms or signature content were changed. *
            </span>
          </label>
          <Button
            type="submit"
            variant="outline"
            disabled={pending || !attested || (!file && !url.trim())}
          >
            {available ? "Replace active executed document" : "Publish executed document"}
          </Button>
        </form>
      )}
    </section>
  )
}
