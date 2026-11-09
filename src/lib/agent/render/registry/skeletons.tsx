"use client"

// Loading placeholders shown while Jarvis is still streaming a component:
// CardSkeleton, StatCardSkeleton, DataTableSkeleton, SchedulePreviewSkeleton.
// Part of the agent render registry; ../registry.tsx combines every group.

import type { ComponentMap } from "./types"

export const skeletonComponents: ComponentMap<
  | "CardSkeleton"
  | "StatCardSkeleton"
  | "DataTableSkeleton"
  | "SchedulePreviewSkeleton"
> = {
  // --- Loading Skeletons ---

  CardSkeleton: ({ props }) => {
    const hasTitle = props.hasTitle ?? true
    const hasDescription = props.hasDescription ?? false
    const lines = props.lines ?? 3

    return (
      <div className="border border-border rounded-xl shadow-sm p-5 bg-card overflow-hidden animate-pulse">
        {hasTitle && (
          <div className="h-4 bg-muted rounded w-1/3 mb-1" />
        )}
        {hasDescription && (
          <div className="h-3 bg-muted rounded w-2/3 mb-3" />
        )}
        <div className="space-y-3">
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className="h-3 bg-muted rounded"
              style={{
                width: `${Math.random() * 40 + 60}%`,
              }}
            />
          ))}
        </div>
      </div>
    )
  },

  StatCardSkeleton: ({ props }) => {
    const hasChange = props.hasChange ?? true

    return (
      <div className="border border-border border-l-4 border-l-primary/30 rounded-xl shadow-sm p-4 bg-card animate-pulse">
        <div className="h-3 bg-muted rounded w-1/4 mb-2 uppercase" />
        <div className="h-9 bg-muted rounded w-1/2 mb-1" />
        {hasChange && (
          <div className="h-3 bg-muted rounded w-1/3" />
        )}
      </div>
    )
  },

  DataTableSkeleton: ({ props }) => {
    const rows = props.rows ?? 5
    const columns = props.columns ?? 4

    return (
      <div className="overflow-x-auto border border-border rounded-xl shadow-sm animate-pulse">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/70">
              {Array.from({ length: columns }).map(
                (_, i) => (
                  <th
                    key={i}
                    className="px-4 py-2.5"
                  >
                    <div className="h-3 bg-muted/50 rounded w-3/4" />
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr
                key={i}
                className="border-b last:border-0"
              >
                {Array.from({ length: columns }).map(
                  (_, j) => (
                    <td
                      key={j}
                      className="px-4 py-2.5"
                    >
                      <div
                        className="h-3 bg-muted rounded"
                        style={{
                          width: `${Math.random() * 40 + 40}%`,
                        }}
                      />
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },

  SchedulePreviewSkeleton: ({ props }) => {
    const tasks = props.tasks ?? 5

    return (
      <div className="border border-border rounded-xl shadow-sm bg-card overflow-hidden animate-pulse">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
        <div className="divide-y">
          {Array.from({ length: tasks }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <div className="size-2 rounded-full bg-muted shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3 bg-muted rounded w-2/3" />
                <div className="h-2 bg-muted rounded w-1/2" />
              </div>
              <div className="w-20 shrink-0">
                <div className="h-2 bg-muted rounded" />
              </div>
              <div className="h-3 bg-muted rounded w-8" />
            </div>
          ))}
        </div>
      </div>
    )
  },
}
