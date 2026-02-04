"use client"

import { useEffect } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  createWorkdayException,
  updateWorkdayException,
} from "@/app/actions/workday-exceptions"
import type {
  WorkdayExceptionData,
  ExceptionCategory,
  ExceptionRecurrence,
} from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const categories: { value: ExceptionCategory; label: string }[] = [
  { value: "national_holiday", label: "National Holiday" },
  { value: "state_holiday", label: "State Holiday" },
  { value: "vacation_day", label: "Vacation Day" },
  { value: "company_holiday", label: "Company Holiday" },
  { value: "weather_day", label: "Weather Day" },
]

const recurrences: { value: ExceptionRecurrence; label: string }[] = [
  { value: "one_time", label: "One Time" },
  { value: "yearly", label: "Yearly" },
]

const exceptionSchema = z.object({
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  type: z.string().min(1),
  category: z.string().min(1),
  recurrence: z.string().min(1),
  notes: z.string(),
})

type ExceptionFormValues = z.infer<typeof exceptionSchema>

interface ExceptionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  editingException: WorkdayExceptionData | null
}

export function WorkdayExceptionFormDialog({
  open,
  onOpenChange,
  projectId,
  editingException,
}: ExceptionFormDialogProps) {
  const router = useRouter()
  const isEditing = !!editingException

  const form = useForm<ExceptionFormValues>({
    resolver: zodResolver(exceptionSchema),
    defaultValues: {
      title: "",
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      type: "non_working",
      category: "company_holiday",
      recurrence: "one_time",
      notes: "",
    },
  })

  useEffect(() => {
    if (editingException) {
      form.reset({
        title: editingException.title,
        startDate: editingException.startDate,
        endDate: editingException.endDate,
        type: editingException.type,
        category: editingException.category,
        recurrence: editingException.recurrence,
        notes: editingException.notes ?? "",
      })
    } else {
      form.reset({
        title: "",
        startDate: new Date().toISOString().split("T")[0],
        endDate: new Date().toISOString().split("T")[0],
        type: "non_working",
        category: "company_holiday",
        recurrence: "one_time",
        notes: "",
      })
    }
  }, [editingException, form])

  async function onSubmit(values: ExceptionFormValues) {
    let result
    if (isEditing) {
      result = await updateWorkdayException(editingException.id, {
        ...values,
        category: values.category as ExceptionCategory,
        recurrence: values.recurrence as ExceptionRecurrence,
        notes: values.notes || null,
      })
    } else {
      result = await createWorkdayException(projectId, {
        ...values,
        category: values.category as ExceptionCategory,
        recurrence: values.recurrence as ExceptionRecurrence,
        notes: values.notes || undefined,
      })
    }

    if (result.success) {
      onOpenChange(false)
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Exception" : "New Workday Exception"}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <ResponsiveDialogBody>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Christmas Day" className="h-9" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" className="h-9" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">End Date</FormLabel>
                    <FormControl>
                      <Input type="date" className="h-9" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Category</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recurrence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Recurrence</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {recurrences.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional notes..."
                      className="resize-none text-sm"
                      rows={1}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
