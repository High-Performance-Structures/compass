import Link from "next/link"
import { IconCheck } from "@tabler/icons-react"
import type { NuTechOrderOverview } from "@/app/actions/nutech-order-overview"
import { FollowUpSection } from "@/components/projects/project-follow-up-aging"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The Nu-Tech order process on an N job's overview: where the job stands,
 * the next thing to do, and the current step's checklist, each item linking
 * to where it is filled in.
 */
export function NuTechOrderStepper({ overview }: { readonly overview: NuTechOrderOverview }): React.ReactElement {
  const { progress, projectId } = overview
  const base = `/dashboard/projects/${encodeURIComponent(projectId)}`
  const current = progress.current
  return (
    <section aria-labelledby="nutech-order-heading" className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="nutech-order-heading" className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
            NU-TECH ORDER
          </h2>
          <p className="text-base font-semibold">
            {progress.cancelled
              ? "This order was cancelled."
              : current
                ? `${current.label}: ${progress.nextAction ?? "Review this step."}`
                : "Order complete."}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={`${base}/nutech`}>{overview.hasOrder ? "Open order" : "Start order"} →</Link>
        </Button>
      </div>

      <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Order steps">
        {progress.steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-1">
            <span
              aria-current={step.state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 border px-2 py-1 font-mono text-xs tracking-[0.06em]",
                step.state === "done" && "border-transparent text-muted-foreground",
                step.state === "current" && "border-primary bg-primary text-primary-foreground",
                step.state === "upcoming" && "border-border text-muted-foreground",
              )}
            >
              {step.state === "done" ? <IconCheck className="size-3" aria-hidden="true" /> : null}
              {step.label.toUpperCase()}
              <span className="sr-only">{step.state === "done" ? " (done)" : step.state === "current" ? " (current)" : ""}</span>
            </span>
            {index < progress.steps.length - 1 ? <span className="text-muted-foreground" aria-hidden="true">·</span> : null}
          </li>
        ))}
      </ol>

      {current && !progress.cancelled ? (
        <ul className="flex flex-col" aria-label={`${current.label} checklist`}>
          {current.checklist.map((entry) => (
            <li key={entry.label}>
              <Link
                href={`${base}/${entry.path}`}
                className="flex min-h-10 items-center gap-3 border-b px-1 text-sm transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center border",
                    entry.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {entry.done ? <IconCheck className="size-3" /> : null}
                </span>
                <span className={cn("flex-1", entry.done && "text-muted-foreground line-through")}>{entry.label}</span>
                <span className="text-xs text-muted-foreground">{entry.done ? "Done" : "Open →"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {overview.followUp ? (
        <div className="border-t pt-3">
          <FollowUpSection projectId={projectId} signal={overview.followUp} compact />
        </div>
      ) : null}
    </section>
  )
}
