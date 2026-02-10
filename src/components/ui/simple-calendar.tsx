"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SimpleCalendarProps {
    selected?: Date
    onSelect?: (date: Date) => void
    /** Dates that should have a dot indicator */
    highlightedDates?: Date[]
    className?: string
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
}

function getDaysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 1).getDay()
}

export function SimpleCalendar({
    selected,
    onSelect,
    highlightedDates = [],
    className
}: SimpleCalendarProps) {
    const today = new Date()
    const [viewYear, setViewYear] = React.useState(selected?.getFullYear() ?? today.getFullYear())
    const [viewMonth, setViewMonth] = React.useState(selected?.getMonth() ?? today.getMonth())

    const daysInMonth = getDaysInMonth(viewYear, viewMonth)
    const firstDay = getFirstDayOfMonth(viewYear, viewMonth)

    // Create array of day numbers with leading empty slots
    const days: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) {
        days.push(null)
    }
    for (let i = 1; i <= daysInMonth; i++) {
        days.push(i)
    }

    const goToPrevMonth = () => {
        if (viewMonth === 0) {
            setViewMonth(11)
            setViewYear(viewYear - 1)
        } else {
            setViewMonth(viewMonth - 1)
        }
    }

    const goToNextMonth = () => {
        if (viewMonth === 11) {
            setViewMonth(0)
            setViewYear(viewYear + 1)
        } else {
            setViewMonth(viewMonth + 1)
        }
    }

    const handleDayClick = (day: number) => {
        const newDate = new Date(viewYear, viewMonth, day)
        onSelect?.(newDate)
    }

    const isHighlighted = (day: number): boolean => {
        const date = new Date(viewYear, viewMonth, day)
        return highlightedDates.some(d => isSameDay(d, date))
    }

    const isSelected = (day: number): boolean => {
        if (!selected) return false
        const date = new Date(viewYear, viewMonth, day)
        return isSameDay(date, selected)
    }

    const isToday = (day: number): boolean => {
        const date = new Date(viewYear, viewMonth, day)
        return isSameDay(date, today)
    }

    return (
        <div className={cn("p-3 bg-background", className)}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={goToPrevMonth}
                >
                    <ChevronLeftIcon className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium select-none">
                    {MONTHS[viewMonth]} {viewYear}
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={goToNextMonth}
                >
                    <ChevronRightIcon className="h-4 w-4" />
                </Button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-2">
                {DAYS.map(day => (
                    <div
                        key={day}
                        className="text-center text-xs text-muted-foreground font-medium py-1 select-none"
                    >
                        {day}
                    </div>
                ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-1">
                {days.map((day, idx) => (
                    <div key={idx} className="aspect-square">
                        {day !== null && (
                            <button
                                type="button"
                                onClick={() => handleDayClick(day)}
                                className={cn(
                                    "w-full h-full rounded-md text-sm font-medium transition-colors relative",
                                    "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                                    isSelected(day) && "bg-primary text-primary-foreground hover:bg-primary/90",
                                    isToday(day) && !isSelected(day) && "bg-accent text-accent-foreground",
                                    !isSelected(day) && !isToday(day) && "text-foreground"
                                )}
                            >
                                {day}
                                {/* Dot indicator for highlighted dates */}
                                {isHighlighted(day) && (
                                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full" />
                                )}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
