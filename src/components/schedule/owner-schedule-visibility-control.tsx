"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconEye } from "@tabler/icons-react"
import { toast } from "sonner"

import { updateOwnerScheduleView } from "@/app/actions/schedule"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"

const OPTIONS: readonly {
  readonly value: OwnerScheduleView
  readonly label: string
  readonly description: string
}[] = [
  {
    value: "items",
    label: "Items",
    description:
      "Owners can see the title, dates, progress, and phase of each schedule item.",
  },
  {
    value: "phases",
    label: "Phases",
    description:
      "Owners see date ranges and progress summarized by phase; item details stay internal.",
  },
]

export function OwnerScheduleVisibilityControl({
  projectId,
  initialValue,
}: {
  readonly projectId: string
  readonly initialValue: OwnerScheduleView
}): React.ReactElement {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [isPending, startTransition] = useTransition()

  function changeView(nextValue: OwnerScheduleView): void {
    if (nextValue === value || isPending) return
    const priorValue = value
    setValue(nextValue)

    startTransition(async () => {
      const result = await updateOwnerScheduleView(projectId, nextValue)
      if (!result.success) {
        setValue(priorValue)
        toast.error(result.error)
        return
      }

      toast.success(
        nextValue === "items"
          ? "Owners can now see individual schedule items."
          : "Owners will now see phase summaries only."
      )
      router.refresh()
    })
  }

  return (
    <div
      className="flex items-center gap-2"
      title={OPTIONS.find((option) => option.value === value)?.description}
    >
      <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground xl:flex">
        <IconEye className="size-3.5" />
        Owner schedule
      </span>
      <div
        className="flex items-center border bg-background"
        aria-label="Owner schedule visibility"
      >
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            aria-pressed={value === option.value}
            title={option.description}
            className={cn(
              "h-8 rounded-none px-2.5 text-xs",
              option.value === "phases" && "border-l",
              value === option.value &&
                "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
            )}
            onClick={() => changeView(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
