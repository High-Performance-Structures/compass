"use client"

import { useState, useCallback, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  IconCalendarPlus,
  IconPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react"
import { WorkdayExceptionFormDialog } from "./workday-exception-form-dialog"
import {
  createWorkdayException,
  deleteWorkdayException,
} from "@/app/actions/workday-exceptions"
import type { WorkdayExceptionData } from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { addDays, format, isWeekend, parseISO } from "date-fns"

interface WorkdayExceptionsViewProps {
  projectId: string
  exceptions: WorkdayExceptionData[]
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM d, yyyy")
  } catch {
    return dateStr
  }
}

function calcDuration(start: string, end: string): number {
  const s = parseISO(start)
  const e = parseISO(end)
  const diff = Math.ceil(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)
  )
  return diff + 1
}

const categoryLabels: Record<string, string> = {
  national_holiday: "National Holiday",
  state_holiday: "State Holiday",
  vacation_day: "Vacation Day",
  company_holiday: "Company Holiday",
  weather_day: "Weather Day",
  extra_workday: "Extra Workday",
}

function nextWeekendDate(): string {
  const today = new Date()
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7
  return format(addDays(today, daysUntilSaturday), "yyyy-MM-dd")
}

export function WorkdayExceptionsView({
  projectId,
  exceptions,
}: WorkdayExceptionsViewProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingException, setEditingException] =
    useState<WorkdayExceptionData | null>(null)
  const [weekendDate, setWeekendDate] = useState(nextWeekendDate)
  const [weekendSaving, setWeekendSaving] = useState(false)

  const weekendOverride = useMemo(
    () =>
      exceptions.find(
        (exception) =>
          exception.type === "working" &&
          exception.recurrence === "one_time" &&
          exception.startDate === weekendDate &&
          exception.endDate === weekendDate
      ),
    [exceptions, weekendDate]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const result = await deleteWorkdayException(id)
      if (result.success) {
        router.refresh()
      } else {
        toast.error(result.error)
      }
    },
    [router]
  )

  const handleWeekendToggle = useCallback(async () => {
    if (!isWeekend(parseISO(weekendDate))) {
      toast.error("Choose a Saturday or Sunday for a weekend override")
      return
    }

    setWeekendSaving(true)
    const result = weekendOverride
      ? await deleteWorkdayException(weekendOverride.id)
      : await createWorkdayException(projectId, {
          title: `Weekend workday — ${format(
            parseISO(weekendDate),
            "MMM d, yyyy"
          )}`,
          startDate: weekendDate,
          endDate: weekendDate,
          type: "working",
          category: "extra_workday",
          recurrence: "one_time",
        })
    setWeekendSaving(false)

    if (result.success) {
      toast.success(
        weekendOverride
          ? "Weekend restored as non-working"
          : "Weekend marked as a workday"
      )
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }, [projectId, router, weekendDate, weekendOverride])

  return (
    <div>
      <div className="mb-4 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Quick weekend override</p>
            <p className="text-xs text-muted-foreground">
              Pick a Saturday or Sunday, then toggle whether crews can work.
            </p>
          </div>
          <Input
            type="date"
            value={weekendDate}
            onChange={(event) => setWeekendDate(event.target.value)}
            className="h-9 sm:w-[165px]"
          />
          <Button
            type="button"
            size="sm"
            variant={weekendOverride ? "outline" : "default"}
            disabled={weekendSaving}
            onClick={handleWeekendToggle}
          >
            <IconCalendarPlus className="mr-1 size-4" />
            {weekendSaving
              ? "Saving..."
              : weekendOverride
                ? "Make non-working"
                : "Make workday"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h2 className="text-lg font-medium min-w-0 break-words">Workday Exceptions</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditingException(null)
            setFormOpen(true)
          }}
          className="whitespace-nowrap"
        >
          <IconPlus className="size-4 mr-1" />
          <span className="hidden sm:inline">Workday Exception</span>
          <span className="sm:hidden">New Exception</span>
        </Button>
      </div>

      <div className="rounded-md border overflow-x-auto -mx-2 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">Title</TableHead>
                <TableHead className="hidden sm:table-cell">Start</TableHead>
                <TableHead className="hidden sm:table-cell">End</TableHead>
                <TableHead className="hidden md:table-cell">Duration</TableHead>
                <TableHead className="hidden md:table-cell">Effect</TableHead>
                <TableHead className="hidden lg:table-cell">Category</TableHead>
                <TableHead className="hidden lg:table-cell">Recurrence</TableHead>
                <TableHead className="hidden lg:table-cell">Notes</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {exceptions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground min-w-0"
                  >
                    <span className="block">No workday exceptions</span>
                  </TableCell>
                </TableRow>
            ) : (
              exceptions.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell className="font-medium text-sm">
                    {ex.title}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                    {formatDate(ex.startDate)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                    {formatDate(ex.endDate)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    {calcDuration(ex.startDate, ex.endDate)} days
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    {ex.type === "working" ? "Working" : "Non-working"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs">
                    {categoryLabels[ex.category] ?? ex.category}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs capitalize">
                    {ex.recurrence.replace("_", " ")}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground truncate max-w-[120px]">
                    {ex.notes || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => {
                          setEditingException(ex)
                          setFormOpen(true)
                        }}
                      >
                        <IconPencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleDelete(ex.id)}
                      >
                        <IconTrash className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      <WorkdayExceptionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
        editingException={editingException}
      />
    </div>
  )
}
