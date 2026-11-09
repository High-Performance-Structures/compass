"use client"

// The agent render registry: maps every component name in ./catalog.ts to the
// React code that draws it when Jarvis replies with a json-render UI.
// The renderers are grouped by kind in ./registry/:
//   layout.tsx        Card, Stack, Grid, Divider, Heading, Text
//   form-fields.tsx   Form, Input, Textarea, Select, Checkbox, Radio, Switch, Button, Link
//   form-controls.tsx the state-bound inputs and form submit logic behind form-fields
//   data-display.tsx  Image, Avatar, Badge, Alert, Progress, Rating
//   charts.tsx        BarGraph, LineGraph
//   code.tsx          CodeBlock, DiffView
//   skeletons.tsx     loading placeholders
//   status-colors.ts  badge colours for statuses
//   types.ts          shared prop and renderer types
// The Compass record cards (StatCard, DataTable, InvoiceTable, ProjectSummary,
// SchedulePreview) are still written out below, with their local money and
// date formatting. To add a component: add it to ./catalog.ts, then add its
// renderer to the matching group file.

import { type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { badgeStatusColor, badgeDotColor } from "./registry/status-colors"

import { chartComponents } from "./registry/charts"
import { codeComponents } from "./registry/code"
import { dataDisplayComponents } from "./registry/data-display"
import { formFieldComponents } from "./registry/form-fields"
import { layoutComponents } from "./registry/layout"
import { skeletonComponents } from "./registry/skeletons"
import type { CatalogComponents, ComponentFn } from "./registry/types"

export type { StreamingState } from "./registry/types"

// formatting helpers
function formatCurrency(v: unknown): string {
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n)
}

function formatDate(v: unknown): string {
  if (typeof v !== "string") return String(v)
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export const components: {
  [K in keyof CatalogComponents]: ComponentFn<K>
} = {
  ...layoutComponents,
  ...formFieldComponents,
  ...dataDisplayComponents,
  ...chartComponents,
  ...codeComponents,

  // --- Compass-specific ---

  StatCard: ({ props }) => {
    const positive = props.change != null && props.change > 0
    const negative = props.change != null && props.change < 0
    const changeColor = positive
      ? "text-success "
      : negative
        ? "text-destructive "
        : "text-muted-foreground"
    const borderColor = positive
      ? "border-l-emerald-500"
      : negative
        ? "border-l-red-500"
        : "border-l-primary/30"
    const arrow = positive ? "\u2191" : negative ? "\u2193" : ""

    return (
      <div
        className={`border border-border border-l-4 ${borderColor} rounded-xl shadow-sm p-4 bg-card`}
      >
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
          {props.title}
        </div>
        <div className="text-3xl font-bold tracking-tight">
          {props.value}
        </div>
        {props.change != null && (
          <div className={`text-xs mt-1 ${changeColor}`}>
            {arrow}
            {props.change > 0 ? "+" : ""}
            {props.change}%
            {props.changeLabel
              ? ` ${props.changeLabel}`
              : ""}
          </div>
        )}
      </div>
    )
  },

  DataTable: ({ props, onAction }) => {
    const cols = props.columns || []
    const rows = props.data || []
    const rowIdKey = props.rowIdKey ?? "id"
    const rowActions = props.rowActions ?? null

    return (
      <div className="overflow-x-auto border border-border rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/70">
              {cols.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground ${
                    col.format === "currency"
                      ? "text-right"
                      : ""
                  }`}
                >
                  {col.header}
                </th>
              ))}
              {rowActions && rowActions.length > 0 && (
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowId = String(
                row[rowIdKey] ?? i
              )
              return (
                <tr
                  key={rowId}
                  className="border-b last:border-0 even:bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  {cols.map((col) => {
                    const val = row[col.key]
                    let display: ReactNode = String(
                      val ?? ""
                    )
                    let cellClass = "px-4 py-2.5"

                    if (col.format === "currency") {
                      display = formatCurrency(val)
                      cellClass +=
                        " font-mono tabular-nums text-right"
                    } else if (col.format === "date") {
                      display = formatDate(val)
                      cellClass += " text-muted-foreground"
                    } else if (col.format === "badge") {
                      const s = String(val ?? "")
                      display = (
                        <Badge
                          variant="secondary"
                          className={badgeStatusColor(s)}
                        >
                          <span
                            className={`size-1.5 rounded-full shrink-0 ${badgeDotColor(s)}`}
                          />
                          {s}
                        </Badge>
                      )
                    }

                    return (
                      <td key={col.key} className={cellClass}>
                        {display}
                      </td>
                    )
                  })}
                  {rowActions && rowActions.length > 0 && (
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        {rowActions.map((ra) => (
                          <Button
                            key={ra.action}
                            variant={
                              ra.variant === "danger"
                                ? "destructive"
                                : "ghost"
                            }
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              const actionName =
                                ra.action.includes(
                                  "delete"
                                )
                                  ? "confirmDelete"
                                  : "mutate"

                              onAction?.({
                                name: actionName,
                                params:
                                  actionName ===
                                  "confirmDelete"
                                    ? {
                                        action: ra.action,
                                        id: rowId,
                                        label:
                                          String(
                                            row[
                                              cols[0]
                                                ?.key ??
                                                ""
                                            ] ?? ""
                                          ) ||
                                          "this item",
                                      }
                                    : {
                                        action:
                                          ra.action,
                                        params: {
                                          id: rowId,
                                        },
                                      },
                              })
                            }}
                          >
                            {ra.label}
                          </Button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  },

  InvoiceTable: ({ props }) => {
    return (
      <div className="overflow-x-auto border border-border rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/70">
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Invoice
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Customer
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Amount
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Due
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {props.invoices.map((inv) => (
              <tr
                key={inv.id}
                className="border-b last:border-0 even:bg-muted/20 hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 py-2.5 font-medium">
                  {inv.number}
                </td>
                <td className="px-4 py-2.5">
                  {inv.customer}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {formatCurrency(inv.amount)}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {formatDate(inv.dueDate)}
                </td>
                <td className="px-4 py-2.5">
                  <Badge
                    variant="secondary"
                    className={badgeStatusColor(
                      inv.status
                    )}
                  >
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${badgeDotColor(inv.status)}`}
                    />
                    {inv.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },

  ProjectSummary: ({ props }) => {
    const pct =
      props.tasksTotal && props.tasksTotal > 0
        ? Math.round(
            ((props.tasksComplete ?? 0) /
              props.tasksTotal) *
              100
          )
        : 0
    const pctColor =
      pct >= 75
        ? "text-success "
        : pct >= 40
          ? "text-warning "
          : "text-destructive "
    const overdue =
      props.daysRemaining != null &&
      props.daysRemaining < 0

    return (
      <div className="border border-border rounded-xl shadow-sm bg-card overflow-hidden">
        <div className="bg-gradient-to-r from-muted/50 to-transparent px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">
              {props.name}
            </div>
            {props.clientName && (
              <div className="text-xs text-muted-foreground">
                {props.clientName}
              </div>
            )}
          </div>
          <Badge
            variant="secondary"
            className={badgeStatusColor(props.status)}
          >
            <span
              className={`size-1.5 rounded-full shrink-0 ${badgeDotColor(props.status)}`}
            />
            {props.status}
          </Badge>
        </div>
        <div className="px-5 py-3 space-y-3">
          {props.address && (
            <div className="text-xs text-muted-foreground">
              {props.address}
            </div>
          )}
          {props.tasksTotal != null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {props.tasksComplete ?? 0} /{" "}
                  {props.tasksTotal} tasks
                </span>
                <span
                  className={`font-medium tabular-nums ${pctColor}`}
                >
                  {pct}%
                </span>
              </div>
              <Progress value={pct} />
            </div>
          )}
          {props.daysRemaining != null && (
            <div
              className={`text-xs ${overdue ? "text-destructive  font-medium" : "text-muted-foreground"}`}
            >
              {overdue
                ? `${Math.abs(props.daysRemaining)} days overdue`
                : `${props.daysRemaining} days remaining`}
            </div>
          )}
        </div>
      </div>
    )
  },

  SchedulePreview: ({ props }) => {
    const limit = props.maxTasks ?? 10
    const tasks = (props.tasks || []).slice(0, limit)
    const groupByPhase = props.groupByPhase ?? false

    const renderTask = (
      t: (typeof tasks)[number],
      i: number
    ) => {
      const pctColor =
        t.percentComplete >= 75
          ? "text-success "
          : t.percentComplete >= 40
            ? "text-warning "
            : "text-destructive "

      return (
        <div
          key={i}
          className="flex items-center gap-3 text-xs px-4 py-2.5 hover:bg-muted/40 transition-colors"
        >
          <span
            className={`size-2 rounded-full shrink-0 ${badgeDotColor(t.status)}`}
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {t.title}
            </div>
            <div className="text-muted-foreground">
              {formatDate(t.startDate)} –{" "}
              {formatDate(t.endDate)}
            </div>
          </div>
          <div className="w-20 shrink-0">
            <Progress value={t.percentComplete} />
          </div>
          <span
            className={`text-xs font-medium tabular-nums w-8 text-right ${pctColor}`}
          >
            {t.percentComplete}%
          </span>
        </div>
      )
    }

    if (groupByPhase) {
      const phases = new Map<
        string,
        typeof tasks
      >()
      for (const t of tasks) {
        const phase = t.phase || "Unassigned"
        const list = phases.get(phase) ?? []
        list.push(t)
        phases.set(phase, list)
      }

      return (
        <div className="border border-border rounded-xl shadow-sm bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="font-semibold text-sm">
              {props.projectName} — Schedule
            </div>
            <span className="text-xs text-muted-foreground">
              {tasks.length} tasks
            </span>
          </div>
          <div className="divide-y">
            {[...phases.entries()].map(
              ([phase, phaseTasks]) => (
                <div key={phase}>
                  <div className="bg-muted/20 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {phase}
                  </div>
                  {phaseTasks.map((t, i) =>
                    renderTask(t, i)
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="border border-border rounded-xl shadow-sm bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="font-semibold text-sm">
            {props.projectName} — Schedule
          </div>
          <span className="text-xs text-muted-foreground">
            {tasks.length} tasks
          </span>
        </div>
        <div className="divide-y">
          {tasks.map((t, i) => renderTask(t, i))}
        </div>
      </div>
    )
  },

  ...skeletonComponents,
}

export function Fallback({ type }: { readonly type: string }) {
  return (
    <div className="text-xs text-muted-foreground">
      [{type}]
    </div>
  )
}
