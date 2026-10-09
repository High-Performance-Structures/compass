"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { IconArrowRight, IconMessageCircleQuestion } from "@tabler/icons-react"

import type { MyFeedbackRequest } from "@/app/actions/feedback-requests"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { feedbackStatusLabel } from "@/lib/jarvis/feedback-lifecycle"

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function isResolved(status: string): boolean {
  return status === "closed" || status === "deployed"
}

export function MyRequestsList({
  requests,
  showingAll,
}: Readonly<{
  requests: readonly MyFeedbackRequest[]
  showingAll: boolean
}>) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState("all")
  const [status, setStatus] = useState("active")
  const availableKinds = useMemo(
    () => [...new Set(requests.map((request) => request.kind))].sort(),
    [requests],
  )
  const availableStatuses = useMemo(
    () => [...new Set(requests.map((request) => request.status))].sort(),
    [requests],
  )
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return requests.filter((request) =>
      (status === "all" ||
        (status === "active" && !isResolved(request.status)) ||
        request.status === status) &&
      (kind === "all" || request.kind === kind) &&
      (normalizedQuery.length === 0 ||
        request.title.toLowerCase().includes(normalizedQuery)),
    )
  }, [kind, query, requests, status])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle className="text-base">Find a request</CardTitle>
            <CardDescription>
              Filters only the requests you are permitted to view. Resolved requests stay available when needed.
            </CardDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm sm:col-span-2"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search request titles"
              type="search"
            />
            <SearchableCombobox
              className="h-9"
              value={status}
              onValueChange={(value) => setStatus(value || "active")}
              options={[
                { value: "active", label: "Active requests" },
                { value: "all", label: "All requests" },
                ...availableStatuses.map((value) => ({
                  value,
                  label: feedbackStatusLabel(value),
                })),
              ]}
              ariaLabel="Filter requests by status"
              placeholder="Active requests"
              searchPlaceholder="Search statuses..."
              emptyMessage="No matching statuses."
            />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger aria-label="Filter requests by type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {availableKinds.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {requests.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <IconMessageCircleQuestion className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No requests yet</p>
              <p className="text-sm text-muted-foreground">
                Requests submitted through Ask Jarvis or Compass Feedback will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {requests.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No requests match these filters. Try showing all requests or clearing the search.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {filtered.map((request) => (
          <Link
            key={request.id}
            href={`/dashboard/requests/${encodeURIComponent(request.id)}${showingAll ? "?scope=all" : ""}`}
            className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="transition-colors group-hover:border-primary/45 group-hover:bg-muted/20">
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{request.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {showingAll && request.reporterName ? `${request.reporterName} · ` : ""}
                      Submitted {formatDate(request.createdAt)}
                    </CardDescription>
                  </div>
                  <IconArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {request.description}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{feedbackStatusLabel(request.status)}</Badge>
                    <Badge variant="outline">{request.kind}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {request.assignedToName ?? "Awaiting assignment"} · Updated {formatDate(request.updatedAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
