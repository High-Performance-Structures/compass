"use client"

import type { UseFormReturn } from "react-hook-form"
import { format, parseISO } from "date-fns"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { IconCalendar } from "@tabler/icons-react"
import type { ScheduleItemFormValues } from "./form-model"

/** Start, duration and end dates, then the optional start and end times. */
export function ScheduleDateFields({
  form,
  calculatedEnd,
  endDateNote,
  setEndDateNote,
  chooseEndDate,
}: {
  readonly form: UseFormReturn<ScheduleItemFormValues>
  readonly calculatedEnd: string
  readonly endDateNote: string | null
  readonly setEndDateNote: (note: string | null) => void
  readonly chooseEndDate: (endDate: string) => void
}) {
  const watchedStart = form.watch("startDate")
  const watchedStartTime = form.watch("startTime")
  return (
    <>
      {/* Date row: Start | Duration | End */}
      <div className="grid grid-cols-[1fr_100px_1fr] gap-2 items-end">
        <FormField
          control={form.control}
          name="startDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground font-medium">
                Start
              </FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className="w-full h-9 justify-start text-left font-normal text-sm"
                    >
                      <IconCalendar className="size-3.5 mr-1.5 text-muted-foreground shrink-0" />
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
                        setEndDateNote(null)
                        field.onChange(format(date, "yyyy-MM-dd"))
                      }
                    }}
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
              <FormLabel className="text-xs text-muted-foreground font-medium">
                Duration
              </FormLabel>
              <div className="flex items-center gap-1">
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    className="h-9 text-center"
                    value={field.value}
                    onChange={(e) => {
                      setEndDateNote(null)
                      field.onChange(Number(e.target.value) || 0)
                    }}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                </FormControl>
                <span className="text-xs text-muted-foreground shrink-0">d</span>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormItem>
          <FormLabel className="text-xs text-muted-foreground font-medium">
            End
          </FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label="End date"
                className="w-full h-9 justify-start text-left font-normal text-sm tabular-nums"
              >
                <IconCalendar className="size-3.5 mr-1.5 text-muted-foreground shrink-0" />
                {calculatedEnd ? format(parseISO(calculatedEnd), "MMM d, yyyy") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={calculatedEnd ? parseISO(calculatedEnd) : undefined}
                disabled={watchedStart ? { before: parseISO(watchedStart) } : undefined}
                onSelect={(date) => {
                  if (date) chooseEndDate(format(date, "yyyy-MM-dd"))
                }}
              />
            </PopoverContent>
          </Popover>
        </FormItem>
      </div>
      {endDateNote && (
        <p className="text-xs text-muted-foreground" role="status">{endDateNote}</p>
      )}

      {/* Optional times; an item with no start time is all day. */}
      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={form.control}
          name="startTime"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground font-medium">
                Start time <span className="font-normal">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="time"
                  className="h-9"
                  value={field.value}
                  onChange={(event) => {
                    field.onChange(event.target.value)
                    if (!event.target.value) form.setValue("endTime", "")
                  }}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="endTime"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground font-medium">
                End time <span className="font-normal">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="time"
                  className="h-9"
                  disabled={!watchedStartTime}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  )
}
