/**
 * Dynamic UI Renderer
 *
 * Renders agent-generated UI specs using shadcn/ui components.
 * Handles action callbacks for interactive elements.
 */

"use client"

import { useCallback } from "react"
import { executeAction } from "@/lib/agent/chat-adapter"
import type { ComponentSpec } from "@/lib/agent/catalog"

// Import shadcn components
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface DynamicUIProps {
  spec: ComponentSpec
  className?: string
}

export function DynamicUI({ spec, className }: DynamicUIProps) {
  const handleAction = useCallback(
    async (action: { type: string; payload?: Record<string, unknown> }) => {
      await executeAction(action)
    },
    []
  )

  return (
    <div className={cn("dynamic-ui", className)}>
      <ComponentRenderer spec={spec} onAction={handleAction} />
    </div>
  )
}

interface RendererProps {
  spec: ComponentSpec
  onAction: (action: { type: string; payload?: Record<string, unknown> }) => void
}

function ComponentRenderer({ spec, onAction }: RendererProps) {
  switch (spec.type) {
    case "DataTable":
      return <DataTableRenderer {...spec.props} onAction={onAction} />

    case "Card":
      return <CardRenderer {...spec.props} onAction={onAction} />

    case "Badge":
      return <Badge variant={spec.props.variant}>{spec.props.label}</Badge>

    case "StatCard":
      return <StatCardRenderer {...spec.props} />

    case "Button":
      return (
        <Button
          variant={spec.props.variant}
          size={spec.props.size}
          onClick={() => onAction(spec.props.action)}
        >
          {spec.props.label}
        </Button>
      )

    case "ButtonGroup":
      return (
        <div className="flex gap-2">
          {spec.props.buttons.map((btn, i) => (
            <Button
              key={i}
              variant={btn.variant}
              size={btn.size}
              onClick={() => onAction(btn.action)}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      )

    case "InvoiceTable":
      return <InvoiceTableRenderer {...spec.props} onAction={onAction} />

    case "CustomerCard":
      return <CustomerCardRenderer {...spec.props} onAction={onAction} />

    case "VendorCard":
      return <VendorCardRenderer {...spec.props} onAction={onAction} />

    case "SchedulePreview":
      return <SchedulePreviewRenderer {...spec.props} onAction={onAction} />

    case "ProjectSummary":
      return <ProjectSummaryRenderer {...spec.props} onAction={onAction} />

    case "Grid":
      return (
        <div
          className={cn(
            "grid gap-4",
            spec.props.columns === 1 && "grid-cols-1",
            spec.props.columns === 2 && "grid-cols-2",
            spec.props.columns === 3 && "grid-cols-3",
            spec.props.columns === 4 && "grid-cols-4"
          )}
          style={{ gap: spec.props.gap }}
        >
          {(spec.props.children as ComponentSpec[])?.map((child, i) => (
            <ComponentRenderer key={i} spec={child} onAction={onAction} />
          ))}
        </div>
      )

    case "Stack":
      return (
        <div
          className={cn(
            "flex",
            spec.props.direction === "horizontal" ? "flex-row" : "flex-col",
            "gap-4"
          )}
          style={{ gap: spec.props.gap }}
        >
          {(spec.props.children as ComponentSpec[])?.map((child, i) => (
            <ComponentRenderer key={i} spec={child} onAction={onAction} />
          ))}
        </div>
      )

    default:
      return (
        <div className="text-muted-foreground text-sm">
          Unknown component type: {(spec as { type: string }).type}
        </div>
      )
  }
}

// DataTable renderer
function DataTableRenderer({
  columns,
  data,
  onRowClick,
  onAction,
}: {
  columns: Array<{ key: string; header: string; format?: string }>
  data: Array<Record<string, unknown>>
  onRowClick?: { type: string; payload?: Record<string, unknown> }
  onAction: RendererProps["onAction"]
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow
              key={i}
              className={onRowClick ? "cursor-pointer hover:bg-muted" : ""}
              onClick={() =>
                onRowClick &&
                onAction({
                  ...onRowClick,
                  payload: { ...onRowClick.payload, rowData: row },
                })
              }
            >
              {columns.map((col) => (
                <TableCell key={col.key}>
                  {formatValue(row[col.key], col.format)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// Card renderer
function CardRenderer({
  title,
  description,
  children,
  footer,
  onAction,
}: {
  title: string
  description?: string
  children?: unknown[]
  footer?: string
  onAction: RendererProps["onAction"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && children.length > 0 && (
        <CardContent>
          {(children as ComponentSpec[]).map((child, i) => (
            <ComponentRenderer key={i} spec={child} onAction={onAction} />
          ))}
        </CardContent>
      )}
      {footer && (
        <CardFooter>
          <p className="text-sm text-muted-foreground">{footer}</p>
        </CardFooter>
      )}
    </Card>
  )
}

// StatCard renderer
function StatCardRenderer({
  title,
  value,
  change,
  changeLabel,
}: {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {change !== undefined && (
        <CardContent>
          <div className="text-xs text-muted-foreground">
            <span className={change >= 0 ? "text-green-600" : "text-red-600"}>
              {change >= 0 ? "+" : ""}
              {change}%
            </span>
            {changeLabel && ` ${changeLabel}`}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// Invoice table renderer
function InvoiceTableRenderer({
  invoices,
  onRowClick,
  onAction,
}: {
  invoices: Array<{
    id: string
    number: string
    customer: string
    amount: number
    dueDate: string
    status: string
  }>
  onRowClick?: { type: string; payload?: Record<string, unknown> }
  onAction: RendererProps["onAction"]
}) {
  const statusVariant = (status: string) => {
    switch (status) {
      case "paid":
        return "default"
      case "overdue":
        return "destructive"
      default:
        return "secondary"
    }
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow
              key={invoice.id}
              className={onRowClick ? "cursor-pointer hover:bg-muted" : ""}
              onClick={() =>
                onRowClick &&
                onAction({
                  ...onRowClick,
                  payload: { ...onRowClick.payload, invoiceId: invoice.id },
                })
              }
            >
              <TableCell className="font-medium">{invoice.number}</TableCell>
              <TableCell>{invoice.customer}</TableCell>
              <TableCell className="text-right">
                {formatCurrency(invoice.amount)}
              </TableCell>
              <TableCell>{formatDate(invoice.dueDate)}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(invoice.status)}>
                  {invoice.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// Customer card renderer
function CustomerCardRenderer({
  customer,
  actions,
  onAction,
}: {
  customer: {
    id: string
    name: string
    company?: string
    email?: string
    phone?: string
  }
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>
  onAction: RendererProps["onAction"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{customer.name}</CardTitle>
        {customer.company && (
          <CardDescription>{customer.company}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {customer.email && <p>Email: {customer.email}</p>}
        {customer.phone && <p>Phone: {customer.phone}</p>}
      </CardContent>
      {actions && actions.length > 0 && (
        <CardFooter className="gap-2">
          {actions.map((action, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => onAction(action)}
            >
              {action.type.replace(/_/g, " ")}
            </Button>
          ))}
        </CardFooter>
      )}
    </Card>
  )
}

// Vendor card renderer
function VendorCardRenderer({
  vendor,
  actions,
  onAction,
}: {
  vendor: {
    id: string
    name: string
    category: string
    email?: string
    phone?: string
  }
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>
  onAction: RendererProps["onAction"]
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{vendor.name}</CardTitle>
          <Badge variant="outline">{vendor.category}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {vendor.email && <p>Email: {vendor.email}</p>}
        {vendor.phone && <p>Phone: {vendor.phone}</p>}
      </CardContent>
      {actions && actions.length > 0 && (
        <CardFooter className="gap-2">
          {actions.map((action, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => onAction(action)}
            >
              {action.type.replace(/_/g, " ")}
            </Button>
          ))}
        </CardFooter>
      )}
    </Card>
  )
}

// Schedule preview renderer
function SchedulePreviewRenderer({
  projectName,
  tasks,
  onTaskClick,
  onAction,
}: {
  projectId: string
  projectName: string
  tasks: Array<{
    id: string
    title: string
    startDate: string
    endDate: string
    phase: string
    status: string
    percentComplete: number
    isCriticalPath?: boolean
  }>
  onTaskClick?: { type: string; payload?: Record<string, unknown> }
  onAction: RendererProps["onAction"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{projectName} Schedule</CardTitle>
        <CardDescription>{tasks.length} tasks</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.slice(0, 5).map((task) => (
          <div
            key={task.id}
            className={cn(
              "p-2 rounded border",
              task.isCriticalPath && "border-red-500",
              onTaskClick && "cursor-pointer hover:bg-muted"
            )}
            onClick={() =>
              onTaskClick &&
              onAction({
                ...onTaskClick,
                payload: { ...onTaskClick.payload, taskId: task.id },
              })
            }
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{task.title}</span>
              <Badge variant="outline">{task.phase}</Badge>
            </div>
            <div className="mt-2">
              <Progress value={task.percentComplete} className="h-1" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{task.percentComplete}% complete</span>
                <span>
                  {formatDate(task.startDate)} - {formatDate(task.endDate)}
                </span>
              </div>
            </div>
          </div>
        ))}
        {tasks.length > 5 && (
          <p className="text-sm text-muted-foreground text-center">
            +{tasks.length - 5} more tasks
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Project summary renderer
function ProjectSummaryRenderer({
  project,
  stats,
  actions,
  onAction,
}: {
  project: {
    id: string
    name: string
    status: string
    address?: string
    clientName?: string
    projectManager?: string
  }
  stats?: {
    tasksTotal: number
    tasksComplete: number
    daysRemaining?: number
    budgetUsed?: number
  }
  actions?: Array<{ type: string; payload?: Record<string, unknown> }>
  onAction: RendererProps["onAction"]
}) {
  const completion = stats
    ? Math.round((stats.tasksComplete / stats.tasksTotal) * 100)
    : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{project.name}</CardTitle>
          <Badge>{project.status}</Badge>
        </div>
        {project.address && (
          <CardDescription>{project.address}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {project.clientName && (
          <p className="text-sm">Client: {project.clientName}</p>
        )}
        {project.projectManager && (
          <p className="text-sm">PM: {project.projectManager}</p>
        )}
        {stats && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Progress</span>
              <span>
                {stats.tasksComplete}/{stats.tasksTotal} tasks ({completion}%)
              </span>
            </div>
            <Progress value={completion} />
          </div>
        )}
      </CardContent>
      {actions && actions.length > 0 && (
        <CardFooter className="gap-2">
          {actions.map((action, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => onAction(action)}
            >
              {action.type.replace(/_/g, " ")}
            </Button>
          ))}
        </CardFooter>
      )}
    </Card>
  )
}

// Utility functions
function formatValue(value: unknown, format?: string): React.ReactNode {
  if (value === null || value === undefined) return "-"

  switch (format) {
    case "currency":
      return formatCurrency(Number(value))
    case "date":
      return formatDate(String(value))
    case "badge":
      return <Badge variant="outline">{String(value)}</Badge>
    default:
      return String(value)
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return dateStr
  }
}

export default DynamicUI
