import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconArrowLeft,
  IconExternalLink,
  IconPlus,
  IconShoppingCart,
} from "@tabler/icons-react"

import {
  createPurchaseOrderRequest,
  getProjectPurchaseOrders,
} from "@/app/actions/project-operations"
import { getProjects } from "@/app/actions/projects"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function cleanFormText(formData: FormData, name: string): string | null {
  const value = readFormText(formData, name).trim()
  return value.length > 0 ? value : null
}

function readMoney(formData: FormData, name: string): number | null {
  const value = readFormText(formData, name).replaceAll(",", "").trim()
  if (value.length === 0) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function money(value: number | null): string {
  if (value === null) return "Amount TBD"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export default async function ProjectPurchaseOrdersPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const [projects, purchaseOrders] = await Promise.all([
    getProjects(),
    getProjectPurchaseOrders(id),
  ])
  const project = projects.find((item) => item.id === id)
  const openPurchaseOrders = purchaseOrders.filter(
    (order) => !["closed", "void", "complete"].includes(order.status)
  )
  const openTotal = openPurchaseOrders.reduce(
    (total, order) => total + (order.amount ?? 0),
    0
  )

  async function createPurchaseOrderAction(formData: FormData): Promise<void> {
    "use server"

    const result = await createPurchaseOrderRequest(id, {
      title: readFormText(formData, "title"),
      description: cleanFormText(formData, "description"),
      companyName: cleanFormText(formData, "companyName"),
      assigneeName: cleanFormText(formData, "assigneeName"),
      costCode: cleanFormText(formData, "costCode"),
      dueDate: cleanFormText(formData, "dueDate"),
      amount: readMoney(formData, "amount"),
      priority: readFormText(formData, "priority"),
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    redirect(`/dashboard/projects/${id}/purchase-orders`)
  }

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/dashboard/projects/${id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <IconShoppingCart className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Purchase Orders
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project?.projectNumber ? `${project.projectNumber} - ` : ""}
            {project?.name ?? "Project"} PO requests, Sage commitments, and
            draft handoff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {openPurchaseOrders.length} open / draft
          </Badge>
          <Badge variant="outline">{money(openTotal)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(20rem,26rem)_1fr]">
        <section className="rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2">
            <IconPlus className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Request PO</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            This creates a Compass draft queued for Sage review/writeback.
          </p>
          <form action={createPurchaseOrderAction} className="mt-4 space-y-3">
            <Input name="title" placeholder="PO title or scope" required />
            <Textarea
              name="description"
              placeholder="Scope, material, delivery notes, or billing context"
              className="min-h-28"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input name="companyName" placeholder="Vendor / supplier" />
              <Input name="assigneeName" placeholder="Internal owner" />
              <Input name="costCode" placeholder="Cost code" />
              <Input name="amount" inputMode="decimal" placeholder="Amount" />
              <Input name="dueDate" type="date" />
              <select
                name="priority"
                defaultValue="normal"
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="normal">Normal priority</option>
                <option value="high">High priority</option>
                <option value="low">Low priority</option>
              </select>
            </div>
            <Button type="submit" className="w-full">
              Create PO Request
            </Button>
          </form>
        </section>

        <section className="space-y-3">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Sage handoff path</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Compass can stage requests here first, then the Sage bridge
                  can write approved POs once permissions and sync rules are
                  finalized.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/financials?tab=bills">
                  Financials
                  <IconExternalLink className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          {purchaseOrders.length > 0 ? (
            purchaseOrders.map((order) => (
              <article key={order.id} className="rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {order.sourceRecordNumber ?? "Unnumbered"}
                    </p>
                    <h2 className="mt-1 text-base font-semibold">
                      {order.title}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={order.status === "draft" ? "secondary" : "outline"}>
                      {label(order.status)}
                    </Badge>
                    <Badge variant="outline">{label(order.syncStatus)}</Badge>
                    {order.priority === "high" && (
                      <Badge variant="destructive">High</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                  <span>{order.companyName ?? "Vendor TBD"}</span>
                  <span>{order.assigneeName ?? "Owner TBD"}</span>
                  <span>{order.costCode ?? "Cost code TBD"}</span>
                  <span>{formatDate(order.dueDate)}</span>
                </div>
                <p className="mt-3 text-sm font-medium">{money(order.amount)}</p>
              </article>
            ))
          ) : (
            <div className="rounded-lg border bg-background p-8 text-center">
              <IconShoppingCart className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-semibold">No PO requests yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a PO request when a vendor commitment is ready to stage.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
