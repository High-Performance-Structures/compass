"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronUp, ChevronDown, ListIcon, CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgendaDay {
    // date: Date (removed to avoid serialization issues)
    dateVal: number // The day of the month (1-31)
    dateStr: string
    dayName: string
    dayTasks: { id: string; title: string }[]
    isToday: boolean
    isWeekend: boolean
}

interface ProjectAgendaSidebarProps {
    weekAgenda: AgendaDay[]
    projectId: string
}

export function ProjectAgendaSidebar({ weekAgenda, projectId }: ProjectAgendaSidebarProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const taskCount = weekAgenda.reduce((acc, d) => acc + d.dayTasks.length, 0)

    return (
        <>
            {/* Desktop Sidebar (Left alignment in flex row is handled by parent) */}
            <div className="hidden lg:block w-72 border-l overflow-y-auto p-4 shrink-0 h-full">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-medium uppercase text-muted-foreground">
                        This Week
                    </h2>
                    <Link
                        href={`/dashboard/projects/${projectId}/schedule`}
                        className="text-xs text-primary hover:underline"
                    >
                        View schedule
                    </Link>
                </div>
                <AgendaList weekAgenda={weekAgenda} />
            </div>

            {/* Mobile Bottom Footer */}
            <div
                className={cn(
                    "lg:hidden fixed bottom-0 left-0 right-0 z-[100] bg-background border-t rounded-t-xl shadow-[0_-4px_12px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out overflow-hidden flex flex-col",
                    isExpanded ? "h-[70vh] pb-safe" : "h-14 pb-safe"
                )}
            >
                {/* Toggle Header */}
                <div
                    className="flex items-center justify-between px-4 h-12 shrink-0 cursor-pointer bg-muted/50 hover:bg-muted/80 active:bg-muted text-foreground border-b"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
                        <span className="font-medium text-sm flex items-center gap-2">
                            <CalendarIcon className="h-4 w-4" />
                            This Week
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full border">
                            {taskCount} tasks
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 content-start">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-semibold">Weekly Agenda</h3>
                        <Link
                            href={`/dashboard/projects/${projectId}/schedule`}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                            View full schedule <ChevronUp className="h-3 w-3 rotate-90" />
                        </Link>
                    </div>
                    <AgendaList weekAgenda={weekAgenda} />
                </div>
            </div>

            {/* Overlay for mobile when expanded */}
            {isExpanded && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/50 z-30 backdrop-blur-sm"
                    onClick={() => setIsExpanded(false)}
                />
            )}
        </>
    )
}

function AgendaList({ weekAgenda }: { weekAgenda: AgendaDay[] }) {
    return (
        <div className="space-y-1 pb-safe">
            {weekAgenda.map((day) => (
                <div
                    key={day.dateStr}
                    className={cn(
                        "flex gap-3 rounded-md p-2 transition-colors",
                        day.isToday ? "bg-primary/10" : "hover:bg-muted/50"
                    )}
                >
                    <div className="text-center shrink-0 w-10 pt-0.5">
                        <p className={cn(
                            "text-lg font-semibold leading-none",
                            day.isToday ? "text-primary" : "text-muted-foreground"
                        )}>
                            {day.dateVal}
                        </p>
                        <p className="text-[10px] uppercase text-muted-foreground font-medium mt-0.5">
                            {day.dayName.substring(0, 3)}
                        </p>
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-baseline justify-between">
                            <p className="text-sm font-medium">{day.dayName}</p>
                            {day.isToday && <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Today</span>}
                        </div>

                        {day.isWeekend ? (
                            <p className="text-xs text-muted-foreground mt-0.5">Non-workday</p>
                        ) : day.dayTasks.length > 0 ? (
                            <div className="space-y-1 mt-1.5">
                                {day.dayTasks.slice(0, 3).map((t) => (
                                    <div key={t.id} className="text-xs bg-background/50 p-1.5 rounded border border-transparent hover:border-border truncate">
                                        {t.title}
                                    </div>
                                ))}
                                {day.dayTasks.length > 3 && (
                                    <p className="text-xs text-muted-foreground pl-1">
                                        +{day.dayTasks.length - 3} more
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground mt-0.5">No tasks scheduled</p>
                        )}
                    </div>
                </div>
            ))}
        </div>
    )
}
