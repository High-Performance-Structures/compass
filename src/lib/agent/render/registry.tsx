"use client"

import { useState, type ReactNode } from "react"
import type { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { compassCatalog } from "./catalog"

// Infer prop types from catalog
type CatalogComponents =
  typeof compassCatalog.data.components

type InferProps<K extends keyof CatalogComponents> =
  CatalogComponents[K] extends { props: z.ZodType<infer P> }
    ? P
    : never

interface ComponentContext<K extends keyof CatalogComponents> {
  readonly props: InferProps<K>
  readonly children?: ReactNode
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
  readonly loading?: boolean
}

type ComponentFn<K extends keyof CatalogComponents> = (
  ctx: ComponentContext<K>
) => ReactNode

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
  // --- Layout ---

  Card: ({ props, children }) => {
    const maxW =
      props.maxWidth === "sm"
        ? "max-w-xs sm:min-w-[280px]"
        : props.maxWidth === "md"
          ? "max-w-sm sm:min-w-[320px]"
          : props.maxWidth === "lg"
            ? "max-w-md sm:min-w-[360px]"
            : "w-full"
    const centered = props.centered ? "mx-auto" : ""

    return (
      <div
        className={`border border-border rounded-lg p-4 bg-card text-card-foreground overflow-hidden ${maxW} ${centered}`}
      >
        {props.title && (
          <div className="font-semibold text-sm mb-1 text-left">
            {props.title}
          </div>
        )}
        {props.description && (
          <div className="text-xs text-muted-foreground mb-3 text-left">
            {props.description}
          </div>
        )}
        <div className="space-y-3">{children}</div>
      </div>
    )
  },

  Stack: ({ props, children }) => {
    const horiz = props.direction === "horizontal"
    const gap =
      props.gap === "lg"
        ? "gap-4"
        : props.gap === "sm"
          ? "gap-2"
          : props.gap === "none"
            ? "gap-0"
            : "gap-3"
    const align =
      props.align === "center"
        ? "items-center"
        : props.align === "end"
          ? "items-end"
          : props.align === "stretch"
            ? "items-stretch"
            : "items-start"
    const justify =
      props.justify === "center"
        ? "justify-center"
        : props.justify === "end"
          ? "justify-end"
          : props.justify === "between"
            ? "justify-between"
            : props.justify === "around"
              ? "justify-around"
              : ""

    return (
      <div
        className={`flex ${horiz ? "flex-row flex-wrap" : "flex-col"} ${gap} ${align} ${justify}`}
      >
        {children}
      </div>
    )
  },

  Grid: ({ props, children }) => {
    const cols =
      props.columns === 4
        ? "grid-cols-4"
        : props.columns === 3
          ? "grid-cols-3"
          : props.columns === 2
            ? "grid-cols-2"
            : "grid-cols-1"
    const gap =
      props.gap === "lg"
        ? "gap-4"
        : props.gap === "sm"
          ? "gap-2"
          : "gap-3"

    return (
      <div className={`grid ${cols} ${gap}`}>
        {children}
      </div>
    )
  },

  Divider: () => <Separator className="my-3" />,

  // --- Typography ---

  Heading: ({ props }) => {
    const level = props.level ?? "h2"
    const cls =
      level === "h1"
        ? "text-2xl font-bold"
        : level === "h3"
          ? "text-base font-semibold"
          : level === "h4"
            ? "text-sm font-semibold"
            : "text-lg font-semibold"

    const Tag = level as "h1" | "h2" | "h3" | "h4"
    return (
      <Tag className={`${cls} text-left`}>
        {props.text}
      </Tag>
    )
  },

  Text: ({ props }) => {
    const cls =
      props.variant === "caption"
        ? "text-xs"
        : props.variant === "muted"
          ? "text-sm text-muted-foreground"
          : "text-sm"

    return <p className={`${cls} text-left`}>{props.text}</p>
  },

  // --- Forms ---

  Input: ({ props }) => (
    <div className="space-y-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        placeholder={props.placeholder ?? ""}
      />
    </div>
  ),

  Textarea: ({ props }) => (
    <div className="space-y-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Textarea
        id={props.name}
        name={props.name}
        placeholder={props.placeholder ?? ""}
        rows={props.rows ?? 3}
      />
    </div>
  ),

  Select: ({ props }) => {
    const [value, setValue] = useState("")
    return (
      <div className="space-y-2">
        <Label>{props.label}</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={props.placeholder ?? "Select..."}
            />
          </SelectTrigger>
          <SelectContent>
            {props.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  },

  Checkbox: ({ props }) => {
    const [checked, setChecked] = useState(
      !!props.checked
    )
    return (
      <div className="flex items-center space-x-2">
        <Checkbox
          id={props.name}
          checked={checked}
          onCheckedChange={(c) => setChecked(c === true)}
        />
        <Label
          htmlFor={props.name}
          className="cursor-pointer"
        >
          {props.label}
        </Label>
      </div>
    )
  },

  Radio: ({ props }) => {
    const [value, setValue] = useState(
      props.options[0] ?? ""
    )
    return (
      <div className="space-y-2">
        {props.label && <Label>{props.label}</Label>}
        <RadioGroup
          value={value}
          onValueChange={setValue}
        >
          {props.options.map((opt) => (
            <div
              key={opt}
              className="flex items-center space-x-2"
            >
              <RadioGroupItem
                value={opt}
                id={`${props.name}-${opt}`}
              />
              <Label
                htmlFor={`${props.name}-${opt}`}
                className="cursor-pointer"
              >
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    )
  },

  Switch: ({ props }) => {
    const [checked, setChecked] = useState(
      !!props.checked
    )
    return (
      <div className="flex items-center justify-between space-x-2">
        <Label
          htmlFor={props.name}
          className="cursor-pointer"
        >
          {props.label}
        </Label>
        <Switch
          id={props.name}
          checked={checked}
          onCheckedChange={setChecked}
        />
      </div>
    )
  },

  // --- Actions ---

  Button: ({ props, onAction, loading }) => {
    const variant =
      props.variant === "danger"
        ? "destructive"
        : props.variant === "secondary"
          ? "secondary"
          : "default"

    return (
      <Button
        variant={variant}
        disabled={loading}
        onClick={() =>
          onAction?.({
            name: props.action ?? "buttonClick",
            params:
              props.actionParams ?? {
                message: props.label,
              },
          })
        }
      >
        {loading ? "..." : props.label}
      </Button>
    )
  },

  Link: ({ props, onAction }) => (
    <Button
      variant="link"
      className="h-auto p-0"
      onClick={() =>
        onAction?.({
          name: "navigateTo",
          params: { path: props.href },
        })
      }
    >
      {props.label}
    </Button>
  ),

  // --- Data Display ---

  Image: ({ props }) => (
    <div
      className="bg-muted border border-border rounded flex items-center justify-center text-xs text-muted-foreground aspect-video"
      style={{
        width: props.width ?? 80,
        height: props.height ?? 60,
      }}
    >
      {props.alt || "img"}
    </div>
  ),

  Avatar: ({ props }) => {
    const initials = (props.name || "?")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
    const size =
      props.size === "lg"
        ? "w-12 h-12 text-base"
        : props.size === "sm"
          ? "w-8 h-8 text-xs"
          : "w-10 h-10 text-sm"

    return (
      <div
        className={`${size} rounded-full bg-muted flex items-center justify-center font-medium`}
      >
        {initials}
      </div>
    )
  },

  Badge: ({ props }) => {
    const variant =
      props.variant === "danger"
        ? "destructive"
        : "default"
    const custom =
      props.variant === "success"
        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
        : props.variant === "warning"
          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
          : ""

    return (
      <Badge
        variant={
          props.variant === "success" ||
          props.variant === "warning"
            ? "secondary"
            : variant
        }
        className={custom}
      >
        {props.text}
      </Badge>
    )
  },

  Alert: ({ props }) => {
    const variant =
      props.type === "error" ? "destructive" : "default"
    const custom =
      props.type === "success"
        ? "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100"
        : props.type === "warning"
          ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100"
          : props.type === "info"
            ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
            : ""

    return (
      <Alert variant={variant} className={custom}>
        <AlertTitle>{props.title}</AlertTitle>
        {props.message && (
          <AlertDescription>
            {props.message}
          </AlertDescription>
        )}
      </Alert>
    )
  },

  Progress: ({ props }) => {
    const value = Math.min(
      100,
      Math.max(0, props.value || 0)
    )
    return (
      <div className="space-y-2">
        {props.label && (
          <Label className="text-sm text-muted-foreground">
            {props.label}
          </Label>
        )}
        <Progress value={value} />
      </div>
    )
  },

  Rating: ({ props }) => {
    const max = props.max ?? 5
    return (
      <div className="space-y-2">
        {props.label && (
          <Label className="text-sm text-muted-foreground">
            {props.label}
          </Label>
        )}
        <div className="flex gap-1">
          {Array.from({ length: max }).map((_, i) => (
            <span
              key={i}
              className={`text-lg ${i < props.value ? "text-yellow-400" : "text-muted"}`}
            >
              *
            </span>
          ))}
        </div>
      </div>
    )
  },

  // --- Charts ---

  BarGraph: ({ props }) => {
    const data = props.data || []
    const maxVal = Math.max(
      ...data.map((d) => d.value),
      1
    )

    return (
      <div className="space-y-2">
        {props.title && (
          <div className="text-sm font-medium text-left">
            {props.title}
          </div>
        )}
        <div className="flex gap-2">
          {data.map((d, i) => (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div className="text-xs text-muted-foreground">
                {d.value}
              </div>
              <div className="w-full h-24 flex items-end">
                <div
                  className="w-full bg-primary rounded-t transition-all"
                  style={{
                    height: `${(d.value / maxVal) * 100}%`,
                    minHeight: 2,
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground truncate w-full text-center">
                {d.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  },

  LineGraph: ({ props }) => {
    const data = props.data || []
    const maxVal = Math.max(
      ...data.map((d) => d.value),
      1
    )
    const minVal = Math.min(
      ...data.map((d) => d.value),
      0
    )
    const range = maxVal - minVal || 1

    const w = 300
    const h = 100
    const pad = { top: 10, right: 10, bottom: 10, left: 10 }
    const cw = w - pad.left - pad.right
    const ch = h - pad.top - pad.bottom

    const pts = data.map((d, i) => ({
      x:
        pad.left +
        (data.length > 1
          ? (i / (data.length - 1)) * cw
          : cw / 2),
      y:
        pad.top +
        ch -
        ((d.value - minVal) / range) * ch,
      ...d,
    }))

    const pathD =
      pts.length > 0
        ? `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`
        : ""

    return (
      <div className="space-y-2">
        {props.title && (
          <div className="text-sm font-medium text-left">
            {props.title}
          </div>
        )}
        <div className="relative h-28">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full h-full"
          >
            {[pad.top, pad.top + ch / 2, h - pad.bottom].map(
              (y, i) => (
                <line
                  key={i}
                  x1={pad.left}
                  y1={y}
                  x2={w - pad.right}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeWidth="1"
                />
              )
            )}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary"
              />
            )}
            {pts.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r="4"
                className="fill-primary"
              />
            ))}
          </svg>
        </div>
        {data.length > 0 && (
          <div className="flex justify-between">
            {data.map((d, i) => (
              <div
                key={i}
                className="text-xs text-muted-foreground text-center"
                style={{
                  width: `${100 / data.length}%`,
                }}
              >
                {d.label}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },

  // --- Compass-specific ---

  StatCard: ({ props }) => {
    const changeColor =
      props.change && props.change > 0
        ? "text-green-600 dark:text-green-400"
        : props.change && props.change < 0
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground"

    return (
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-xs text-muted-foreground mb-1">
          {props.title}
        </div>
        <div className="text-2xl font-bold">
          {props.value}
        </div>
        {props.change != null && (
          <div className={`text-xs mt-1 ${changeColor}`}>
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

  DataTable: ({ props }) => {
    const cols = props.columns || []
    const rows = props.data || []

    return (
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {cols.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left font-medium text-muted-foreground"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                {cols.map((col) => {
                  const val = row[col.key]
                  let display: ReactNode = String(
                    val ?? ""
                  )

                  if (col.format === "currency") {
                    display = formatCurrency(val)
                  } else if (col.format === "date") {
                    display = formatDate(val)
                  } else if (col.format === "badge") {
                    display = (
                      <Badge variant="secondary">
                        {String(val)}
                      </Badge>
                    )
                  }

                  return (
                    <td key={col.key} className="px-3 py-2">
                      {display}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },

  InvoiceTable: ({ props }) => {
    const statusColor: Record<string, string> = {
      paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
      sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
      draft:
        "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100",
      overdue:
        "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
    }

    return (
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Invoice
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Customer
              </th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                Amount
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Due
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {props.invoices.map((inv) => (
              <tr
                key={inv.id}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                <td className="px-3 py-2 font-medium">
                  {inv.number}
                </td>
                <td className="px-3 py-2">
                  {inv.customer}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(inv.amount)}
                </td>
                <td className="px-3 py-2">
                  {formatDate(inv.dueDate)}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant="secondary"
                    className={
                      statusColor[inv.status] ?? ""
                    }
                  >
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

    return (
      <div className="border border-border rounded-lg p-4 bg-card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">
              {props.name}
            </div>
            {props.clientName && (
              <div className="text-xs text-muted-foreground">
                {props.clientName}
              </div>
            )}
          </div>
          <Badge variant="secondary">
            {props.status}
          </Badge>
        </div>
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
              <span>{pct}%</span>
            </div>
            <Progress value={pct} />
          </div>
        )}
        {props.daysRemaining != null && (
          <div className="text-xs text-muted-foreground">
            {props.daysRemaining} days remaining
          </div>
        )}
      </div>
    )
  },

  SchedulePreview: ({ props }) => {
    const tasks = (props.tasks || []).slice(0, 5)
    return (
      <div className="border border-border rounded-lg p-4 bg-card space-y-3">
        <div className="font-semibold text-sm">
          {props.projectName} — Schedule
        </div>
        {tasks.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-3 text-xs"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {t.title}
              </div>
              <div className="text-muted-foreground">
                {t.phase} &middot; {formatDate(t.startDate)}{" "}
                – {formatDate(t.endDate)}
              </div>
            </div>
            <div className="w-20 shrink-0">
              <Progress value={t.percentComplete} />
            </div>
            <Badge
              variant="secondary"
              className="shrink-0"
            >
              {t.status}
            </Badge>
          </div>
        ))}
      </div>
    )
  },
}

export function Fallback({ type }: { readonly type: string }) {
  return (
    <div className="text-xs text-muted-foreground">
      [{type}]
    </div>
  )
}
