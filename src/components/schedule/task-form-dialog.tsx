"use client"

import * as React from "react"
import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { IconCalendar } from "@tabler/icons-react"
import { format, parseISO } from "date-fns"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { createTask, updateTask } from "@/app/actions/schedule"
import { calculateEndDate } from "@/lib/schedule/business-days"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { PHASE_ORDER, PHASE_LABELS } from "@/lib/schedule/phase-colors"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const phases = PHASE_ORDER.map((value) => ({
  value,
  label: PHASE_LABELS[value],
}))

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  workdays: z.number().min(1, "Must be at least 1 day"),
  phase: z.string().min(1, "Phase is required"),
  isMilestone: z.boolean(),
  percentComplete: z.number().min(0).max(100),
  assignedTo: z.string(),
})

type TaskFormValues = z.infer<typeof taskSchema>

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  editingTask: ScheduleTaskData | null
}

export function TaskFormDialog({
  open,
  onOpenChange,
  projectId,
  editingTask,
}: TaskFormDialogProps) {
  const router = useRouter()
  const isEditing = !!editingTask

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      startDate: new Date().toISOString().split("T")[0],
      workdays: 5,
      phase: "preconstruction",
      isMilestone: false,
      percentComplete: 0,
      assignedTo: "",
    },
  })

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setIsOtherPhase(false)
      setCustomPhase("")
      return
    }
    
    if (editingTask) {
      const isCustomPhase = !phases.some(p => p.value === editingTask.phase)
      setIsOtherPhase(isCustomPhase)
      if (isCustomPhase) {
        setCustomPhase(editingTask.phase)
      }
      form.reset({
        title: editingTask.title,
        startDate: editingTask.startDate,
        workdays: editingTask.workdays,
        phase: editingTask.phase,
        isMilestone: editingTask.isMilestone,
        percentComplete: editingTask.percentComplete,
        assignedTo: editingTask.assignedTo ?? "",
      })
    } else {
      setIsOtherPhase(false)
      setCustomPhase("")
      form.reset({
        title: "",
        startDate: new Date().toISOString().split("T")[0],
        workdays: 5,
        phase: "preconstruction",
        isMilestone: false,
        percentComplete: 0,
        assignedTo: "",
      })
    }
  }, [editingTask, form, open])

  const watchedStart = form.watch("startDate")
  const watchedWorkdays = form.watch("workdays")

  const calculatedEnd = useMemo(() => {
    if (!watchedStart || !watchedWorkdays || watchedWorkdays < 1) return ""
    return calculateEndDate(watchedStart, watchedWorkdays)
  }, [watchedStart, watchedWorkdays])

  async function onSubmit(values: TaskFormValues) {
    // Validate custom phase if "Other" is selected
    if (isOtherPhase && (!customPhase || customPhase.trim() === "")) {
      toast.error("Please enter a custom phase name")
      return
    }
    
    // Ensure we're not submitting "other" as the phase value
    const finalValues = {
      ...values,
      phase: isOtherPhase && customPhase ? customPhase : values.phase,
    }
    
    let result
    if (isEditing) {
      result = await updateTask(editingTask.id, {
        ...finalValues,
        assignedTo: finalValues.assignedTo || null,
      })
    } else {
      result = await createTask(projectId, {
        ...finalValues,
        assignedTo: finalValues.assignedTo || undefined,
      })
    }

    if (result.success) {
      onOpenChange(false)
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  const [customPhase, setCustomPhase] = React.useState("")
  const [isOtherPhase, setIsOtherPhase] = React.useState(false)

  const page1 = (
    <>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Title</FormLabel>
            <FormControl>
              <Input placeholder="Task title" className="h-9" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="startDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Start Date</FormLabel>
            <Popover>
              <PopoverTrigger asChild>
                <FormControl>
                  <Button
                    variant="outline"
                    className="w-full h-9 justify-start text-left font-normal text-sm"
                  >
                    <IconCalendar className="size-3.5 mr-2 text-muted-foreground" />
                    {field.value
                      ? format(parseISO(field.value), "MMM d, yyyy")
                      : "Pick date"}
                  </Button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={field.value ? parseISO(field.value) : undefined}
                  onSelect={(date) => {
                    if (date) {
                      field.onChange(format(date, "yyyy-MM-dd"))
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="workdays"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Workdays</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                className="h-9"
                value={field.value}
                onChange={(e) =>
                  field.onChange(Number(e.target.value) || 0)
                }
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )

  const page2 = (
    <>
      <FormField
        control={form.control}
        name="phase"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Phase</FormLabel>
            <Select
              onValueChange={(value) => {
                if (value === "other") {
                  setIsOtherPhase(true)
                  field.onChange(customPhase || "other")
                } else {
                  setIsOtherPhase(false)
                  field.onChange(value)
                }
              }}
              value={isOtherPhase ? "other" : field.value}
            >
              <FormControl>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select phase" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {phases.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {isOtherPhase && (
        <FormItem>
          <FormLabel className="text-xs">Custom Phase</FormLabel>
          <FormControl>
            <Input
              placeholder="Enter custom phase"
              className="h-9"
              value={customPhase}
              onChange={(e) => {
                setCustomPhase(e.target.value)
                form.setValue("phase", e.target.value)
              }}
            />
          </FormControl>
        </FormItem>
      )}

      <FormField
        control={form.control}
        name="assignedTo"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Assigned To</FormLabel>
            <FormControl>
              <Input placeholder="Person name" className="h-9" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )

  const page3 = (
    <>
      {calculatedEnd && (
        <p className="text-xs text-muted-foreground">
          End date: <strong>{calculatedEnd}</strong>
        </p>
      )}

      <FormField
        control={form.control}
        name="percentComplete"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              Complete: {field.value}%
            </FormLabel>
            <FormControl>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[field.value]}
                onValueChange={([val]) => field.onChange(val)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="isMilestone"
        render={({ field }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
            <FormLabel className="!mt-0 text-xs">Milestone</FormLabel>
          </FormItem>
        )}
      />
    </>
  )

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Task" : "New Task"}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <ResponsiveDialogBody>
            <div className="space-y-4">
              {page1}
              {page2}
              {page3}
            </div>
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9"
            >
              Cancel
            </Button>
            <Button type="submit" className="h-9">
              {isEditing ? "Save" : "Create"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </Form>
    </ResponsiveDialog>
  )
}
