"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconUsers } from "@tabler/icons-react"
import { toast } from "sonner"

import { updateSubScheduleView } from "@/app/actions/schedule-sub-visibility"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SubScheduleView } from "@/lib/project-audience-schedule-visibility"

const OPTIONS: readonly {
  readonly value: SubScheduleView
  readonly label: string
  readonly description: string
}[] = [
  {
    value: "assigned",
    label: "Their items",
    description:
      "Subs and suppliers see the items they're responsible for, plus items marked \"Subs can view\".",
  },
  {
    value: "full",
    label: "Full schedule",
    description: "Every sub and supplier on this job sees the whole published schedule.",
  },
]

/** Beside the owner control: what subs and suppliers see of this job's published schedule. */
export function SubScheduleVisibilityControl({
  projectId,
  initialValue,
}: {
  readonly projectId: string
  readonly initialValue: SubScheduleView
}): React.ReactElement {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [isPending, startTransition] = useTransition()

  function changeView(nextValue: SubScheduleView): void {
    if (nextValue === value || isPending) return
    const priorValue = value
    setValue(nextValue)
    startTransition(async () => {
      const result = await updateSubScheduleView(projectId, nextValue)
      if (!result.success) {
        setValue(priorValue)
        toast.error(result.error)
        return
      }
      toast.success(
        nextValue === "full"
          ? "Subs now see the full published schedule."
          : "Subs now see their own items and items marked for subs."
      )
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2" title={OPTIONS.find((option) => option.value === value)?.description}>
      <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground 2xl:flex">
        <IconUsers className="size-3.5" />
        Subs see
      </span>
      <div className="flex items-center border bg-background" aria-label="Sub schedule visibility">
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
              option.value === "full" && "border-l",
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
