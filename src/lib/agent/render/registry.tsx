"use client"

import { useState, type ReactNode } from "react"
import type { z } from "zod"
import type { BundledLanguage } from "shiki"
import { useDataBinding, useData } from "@json-render/react"

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
import {
  CodeBlock as ShikiCodeBlock,
  CodeBlockCopyButton,
} from "@/components/ai/code-block"

import { compassCatalog } from "./catalog"
import { FormIdProvider, useFormId } from "./form-context"

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

function badgeStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "complete":
    case "completed":
    case "paid":
    case "active":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
    case "in progress":
    case "in_progress":
    case "sent":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
    case "pending":
    case "draft":
    case "not started":
    case "not_started":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
    case "overdue":
    case "delayed":
    case "cancelled":
    case "canceled":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
    case "warning":
    case "at risk":
    case "at_risk":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
  }
}

function badgeDotColor(status: string): string {
  switch (status.toLowerCase()) {
    case "complete":
    case "completed":
    case "paid":
    case "active":
      return "bg-emerald-500"
    case "in progress":
    case "in_progress":
    case "sent":
      return "bg-blue-500"
    case "pending":
    case "draft":
    case "not started":
    case "not_started":
      return "bg-gray-400"
    case "overdue":
    case "delayed":
    case "cancelled":
    case "canceled":
      return "bg-red-500"
    case "warning":
    case "at risk":
    case "at_risk":
      return "bg-amber-500"
    default:
      return "bg-gray-400"
  }
}

// Form input wrapper that uses data binding
function BoundInput({
  name,
  label,
  type,
  placeholder,
  defaultValue,
}: {
  readonly name: string
  readonly label: string
  readonly type: string
  readonly placeholder: string
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useDataBinding<string>(path)

  // seed default value on first render
  if (value === undefined && defaultValue) {
    setValue(defaultValue)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value ?? defaultValue ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  )
}

function BoundTextarea({
  name,
  label,
  placeholder,
  rows,
  defaultValue,
}: {
  readonly name: string
  readonly label: string
  readonly placeholder: string
  readonly rows: number
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useDataBinding<string>(path)

  if (value === undefined && defaultValue) {
    setValue(defaultValue)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        placeholder={placeholder}
        rows={rows}
        value={value ?? defaultValue ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  )
}

function BoundSelect({
  name,
  label,
  options,
  placeholder,
  defaultValue,
}: {
  readonly name: string
  readonly label: string
  readonly options: ReadonlyArray<string>
  readonly placeholder: string
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useDataBinding<string>(path)

  if (value === undefined && defaultValue) {
    setValue(defaultValue)
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value ?? defaultValue ?? ""}
        onValueChange={setValue}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function BoundCheckbox({
  name,
  label,
  defaultChecked,
  onChangeAction,
  onChangeParams,
  onAction,
}: {
  readonly name: string
  readonly label: string
  readonly defaultChecked: boolean
  readonly onChangeAction?: string
  readonly onChangeParams?: Record<string, unknown>
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] =
    useDataBinding<boolean>(path)

  if (value === undefined) {
    setValue(defaultChecked)
  }

  const checked = value ?? defaultChecked

  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={name}
        checked={checked}
        onCheckedChange={(c) => {
          const next = c === true
          setValue(next)
          if (onChangeAction && onAction) {
            onAction({
              name: "mutate",
              params: {
                action: onChangeAction,
                params: onChangeParams ?? {},
              },
            })
          }
        }}
      />
      <Label
        htmlFor={name}
        className={`cursor-pointer ${
          checked
            ? "line-through text-muted-foreground"
            : ""
        }`}
      >
        {label}
      </Label>
    </div>
  )
}

function BoundRadio({
  name,
  label,
  options,
  defaultValue,
}: {
  readonly name: string
  readonly label?: string
  readonly options: ReadonlyArray<string>
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useDataBinding<string>(path)

  const initial = defaultValue ?? options[0] ?? ""
  if (value === undefined) {
    setValue(initial)
  }

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <RadioGroup
        value={value ?? initial}
        onValueChange={setValue}
      >
        {options.map((opt) => (
          <div
            key={opt}
            className="flex items-center space-x-2"
          >
            <RadioGroupItem
              value={opt}
              id={`${name}-${opt}`}
            />
            <Label
              htmlFor={`${name}-${opt}`}
              className="cursor-pointer"
            >
              {opt}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}

function BoundSwitch({
  name,
  label,
  defaultChecked,
  onChangeAction,
  onChangeParams,
  onAction,
}: {
  readonly name: string
  readonly label: string
  readonly defaultChecked: boolean
  readonly onChangeAction?: string
  readonly onChangeParams?: Record<string, unknown>
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] =
    useDataBinding<boolean>(path)

  if (value === undefined) {
    setValue(defaultChecked)
  }

  return (
    <div className="flex items-center justify-between space-x-2">
      <Label
        htmlFor={name}
        className="cursor-pointer"
      >
        {label}
      </Label>
      <Switch
        id={name}
        checked={value ?? defaultChecked}
        onCheckedChange={(next) => {
          setValue(next)
          if (onChangeAction && onAction) {
            onAction({
              name: "mutate",
              params: {
                action: onChangeAction,
                params: onChangeParams ?? {},
              },
            })
          }
        }}
      />
    </div>
  )
}

// Form component that collects bound values and submits
function FormComponent({
  formId,
  action,
  actionParams,
  submitLabel,
  children,
  onAction,
}: {
  readonly formId: string
  readonly action: string
  readonly actionParams?: Record<string, unknown>
  readonly submitLabel?: string
  readonly children?: ReactNode
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const dataCtx = useData()

  const handleSubmit = async () => {
    setSubmitting(true)
    setFeedback(null)

    // collect all values under /form/{formId}/
    const formData: Record<string, unknown> = {}

    // walk the data model to find form values
    const allData = dataCtx.data
    if (
      allData &&
      typeof allData === "object" &&
      "form" in allData
    ) {
      const forms = allData.form as Record<
        string,
        Record<string, unknown>
      >
      if (forms && forms[formId]) {
        Object.assign(formData, forms[formId])
      }
    }

    // also try path-based get for nested data
    // the DataProvider supports path-based access
    const rawVal = dataCtx.get(`/form/${formId}`)
    if (rawVal && typeof rawVal === "object") {
      Object.assign(
        formData,
        rawVal as Record<string, unknown>,
      )
    }

    onAction?.({
      name: "formSubmit",
      params: {
        action,
        formData,
        actionParams: actionParams ?? {},
      },
    })

    setSubmitting(false)
  }

  return (
    <FormIdProvider value={formId}>
      <div className="space-y-4">
        {children}
        {feedback && (
          <div
            className={`text-sm px-3 py-2 rounded ${
              feedback.type === "success"
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
            }`}
          >
            {feedback.message}
          </div>
        )}
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full"
        >
          {submitting
            ? "Saving..."
            : submitLabel ?? "Submit"}
        </Button>
      </div>
    </FormIdProvider>
  )
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
    const accent = props.title
      ? "border-t-2 border-t-primary/20"
      : ""

    return (
      <div
        className={`border border-border rounded-xl shadow-sm p-5 bg-card text-card-foreground overflow-hidden ${accent} ${maxW} ${centered}`}
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

  // --- Form Container ---

  Form: ({ props, children, onAction }) => (
    <FormComponent
      formId={props.formId}
      action={props.action}
      actionParams={
        (props.actionParams as
          | Record<string, unknown>
          | undefined) ?? undefined
      }
      submitLabel={props.submitLabel ?? undefined}
      onAction={onAction}
    >
      {children}
    </FormComponent>
  ),

  // --- Form Inputs ---

  Input: ({ props }) => (
    <BoundInput
      name={props.name}
      label={props.label}
      type={props.type ?? "text"}
      placeholder={props.placeholder ?? ""}
      defaultValue={props.value ?? undefined}
    />
  ),

  Textarea: ({ props }) => (
    <BoundTextarea
      name={props.name}
      label={props.label}
      placeholder={props.placeholder ?? ""}
      rows={props.rows ?? 3}
      defaultValue={props.value ?? undefined}
    />
  ),

  Select: ({ props }) => (
    <BoundSelect
      name={props.name}
      label={props.label}
      options={props.options}
      placeholder={props.placeholder ?? "Select..."}
      defaultValue={props.value ?? undefined}
    />
  ),

  Checkbox: ({ props, onAction }) => (
    <BoundCheckbox
      name={props.name}
      label={props.label}
      defaultChecked={!!props.checked}
      onChangeAction={props.onChangeAction ?? undefined}
      onChangeParams={
        (props.onChangeParams as
          | Record<string, unknown>
          | undefined) ?? undefined
      }
      onAction={onAction}
    />
  ),

  Radio: ({ props }) => (
    <BoundRadio
      name={props.name}
      label={props.label}
      options={props.options}
      defaultValue={props.value ?? undefined}
    />
  ),

  Switch: ({ props, onAction }) => (
    <BoundSwitch
      name={props.name}
      label={props.label}
      defaultChecked={!!props.checked}
      onChangeAction={props.onChangeAction ?? undefined}
      onChangeParams={
        (props.onChangeParams as
          | Record<string, unknown>
          | undefined) ?? undefined
      }
      onAction={onAction}
    />
  ),

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
    const colorMap: Record<string, string> = {
      success:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      warning:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
      danger:
        "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    }
    const dotMap: Record<string, string> = {
      success: "bg-emerald-500",
      warning: "bg-amber-500",
      danger: "bg-red-500",
      default: "bg-gray-400",
    }
    const v = props.variant ?? "default"
    const colors = colorMap[v] ?? ""
    const dot = dotMap[v] ?? dotMap.default

    return (
      <Badge
        variant={v === "default" ? "default" : "secondary"}
        className={colors}
      >
        <span
          className={`size-1.5 rounded-full shrink-0 ${dot}`}
        />
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
    const pctColor =
      value >= 75
        ? "text-emerald-600 dark:text-emerald-400"
        : value >= 40
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400"

    return (
      <div className="space-y-2">
        {props.label && (
          <Label className="text-sm text-muted-foreground">
            {props.label}
          </Label>
        )}
        <div className="flex items-center gap-2">
          <Progress value={value} className="flex-1" />
          <span
            className={`text-xs font-medium tabular-nums ${pctColor}`}
          >
            {value}%
          </span>
        </div>
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

  // --- Code ---

  CodeBlock: ({ props }) => {
    const lang = (props.language || "text") as BundledLanguage
    return (
      <div className="rounded-xl shadow-sm border overflow-hidden">
        {props.title && (
          <div className="bg-muted/50 px-4 py-1.5 text-xs font-medium border-b">
            {props.title}
          </div>
        )}
        <ShikiCodeBlock
          code={props.code}
          language={lang}
          showLineNumbers={props.showLineNumbers ?? false}
          className="rounded-none border-0 shadow-none"
        >
          <CodeBlockCopyButton />
        </ShikiCodeBlock>
      </div>
    )
  },

  DiffView: ({ props }) => {
    const [expanded, setExpanded] = useState<
      Record<number, boolean>
    >({})

    const toggle = (idx: number) =>
      setExpanded((prev) => ({
        ...prev,
        [idx]: !prev[idx],
      }))

    const statusBadge = (status: string) => {
      const colors: Record<string, string> = {
        added:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        modified:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
        removed:
          "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
        renamed:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
      }
      return (
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${colors[status] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
        >
          {status}
        </span>
      )
    }

    const renderPatch = (patch: string | null) => {
      if (!patch) {
        return (
          <div className="px-4 py-3 text-xs text-muted-foreground italic">
            (binary file or no changes)
          </div>
        )
      }
      const lines = patch.split("\n")
      return (
        <pre className="font-mono text-xs leading-5 overflow-x-auto">
          {lines.map((line, i) => {
            let cls = "px-4"
            if (line.startsWith("+")) {
              cls +=
                " bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            } else if (line.startsWith("-")) {
              cls +=
                " bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-300"
            } else if (line.startsWith("@@")) {
              cls +=
                " bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
            }
            return (
              <div key={i} className={cls}>
                {line}
              </div>
            )
          })}
        </pre>
      )
    }

    const files = props.files || []

    return (
      <div className="rounded-xl shadow-sm border overflow-hidden">
        {(props.title ||
          props.commitSha ||
          props.stats) && (
          <div className="px-4 py-3 border-b bg-muted/30 space-y-1">
            {props.title && (
              <div className="font-semibold text-sm">
                {props.title}
              </div>
            )}
            {(props.commitSha ||
              props.commitMessage) && (
              <div className="flex items-center gap-2 text-xs">
                {props.commitSha && (
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
                    {props.commitSha}
                  </code>
                )}
                {props.commitMessage && (
                  <span className="text-muted-foreground truncate">
                    {props.commitMessage}
                  </span>
                )}
              </div>
            )}
            {props.stats && (
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{props.stats.additions}
                </span>
                <span className="text-red-600 dark:text-red-400">
                  -{props.stats.deletions}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="divide-y">
          {files.map((file, idx) => {
            const isOpen = expanded[idx] ?? idx === 0
            return (
              <div key={idx}>
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full px-4 py-2 flex items-center gap-2 text-xs hover:bg-muted/40 transition-colors text-left"
                >
                  <span className="font-mono flex-1 truncate">
                    {file.filename}
                  </span>
                  {statusBadge(file.status)}
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{file.additions}
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    -{file.deletions}
                  </span>
                  <span className="text-muted-foreground">
                    {isOpen ? "\u25BC" : "\u25B6"}
                  </span>
                </button>
                {isOpen && renderPatch(file.patch)}
              </div>
            )
          })}
        </div>
      </div>
    )
  },

  // --- Compass-specific ---

  StatCard: ({ props }) => {
    const positive = props.change != null && props.change > 0
    const negative = props.change != null && props.change < 0
    const changeColor = positive
      ? "text-emerald-600 dark:text-emerald-400"
      : negative
        ? "text-red-600 dark:text-red-400"
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
        ? "text-emerald-600 dark:text-emerald-400"
        : pct >= 40
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400"
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
              className={`text-xs ${overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}
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
          ? "text-emerald-600 dark:text-emerald-400"
          : t.percentComplete >= 40
            ? "text-amber-600 dark:text-amber-400"
            : "text-red-600 dark:text-red-400"

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
}

export function Fallback({ type }: { readonly type: string }) {
  return (
    <div className="text-xs text-muted-foreground">
      [{type}]
    </div>
  )
}
