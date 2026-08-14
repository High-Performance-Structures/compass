export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconInbox, IconMailForward } from "@tabler/icons-react"

import {
  dismissInboundEmail,
  getInboundEmailReviewQueue,
  routeInboundEmailToRfi,
} from "@/app/actions/inbound-email-review"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function receivedLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export default async function InboundEmailReviewPage(): Promise<React.ReactElement> {
  const queue = await getInboundEmailReviewQueue()

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 lg:p-6">
      <header className="border-b pb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link href="/dashboard/projects">
            <IconArrowLeft className="size-4" />
            Project Hub
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <IconInbox className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Inbound email review
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Route tagged email that Compass could not assign confidently. The
          original email remains in the audit record after routing or dismissal.
        </p>
      </header>

      {queue.items.length === 0 ? (
        <section className="border border-dashed p-8 text-center">
          <IconMailForward className="mx-auto size-7 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">No email needs review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Confident project matches will create their tagged Compass record automatically.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          {queue.items.map((item) => (
            <article
              id={`inbound-${item.id}`}
              key={item.id}
              className="border bg-background p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{item.subject}</h2>
                    <Badge variant={item.kind === "rfi" ? "default" : "secondary"}>
                      {item.kind === "rfi" ? "RFI" : "Unclassified"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    From {item.fromName ?? item.fromAddress} · {receivedLabel(item.receivedAt)}
                  </p>
                  {item.toAddress ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Delivered to {item.toAddress}
                    </p>
                  ) : null}
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6">
                {item.bodyPreview}
              </p>

              <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
                {item.kind === "rfi" ? (
                  <form action={routeInboundEmailToRfi} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="emailId" value={item.id} />
                    <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                      Project
                      <select
                        name="projectId"
                        required
                        defaultValue={item.suggestedProjectId ?? ""}
                        className="h-10 border bg-background px-3 font-normal"
                      >
                        <option value="" disabled>Select project…</option>
                        {queue.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.projectNumber ? `${project.projectNumber} — ` : ""}
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit">Create RFI</Button>
                  </form>
                ) : (
                  <p className="flex-1 text-sm text-muted-foreground">
                    Add a supported subject tag before routing this email.
                  </p>
                )}
                <form action={dismissInboundEmail}>
                  <input type="hidden" name="emailId" value={item.id} />
                  <Button type="submit" variant="outline">Dismiss</Button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
