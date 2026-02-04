"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  IconArrowLeft,
  IconX,
  IconDashboard,
  IconFolder,
  IconFiles,
  IconCalendarStats,
  IconSun,
  IconSearch,
  IconCheck,
  IconUsers,
  IconBuildingStore,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { getCustomers } from "@/app/actions/customers"
import { getVendors } from "@/app/actions/vendors"
import { getProjects } from "@/app/actions/projects"

interface MobileSearchProps {
  open: boolean
  setOpen: (open: boolean) => void
}

type ItemCategory =
  | "navigation"
  | "action"
  | "customer"
  | "vendor"
  | "project"

interface SearchItem {
  icon: typeof IconDashboard
  label: string
  sublabel?: string
  href?: string
  category: ItemCategory
  action?: string
  createdAt?: string
}

const staticItems: SearchItem[] = [
  {
    icon: IconDashboard,
    label: "Dashboard",
    href: "/dashboard",
    category: "navigation",
  },
  {
    icon: IconFolder,
    label: "Projects",
    href: "/dashboard/projects",
    category: "navigation",
  },
  {
    icon: IconFiles,
    label: "Files",
    href: "/dashboard/files",
    category: "navigation",
  },
  {
    icon: IconCalendarStats,
    label: "Schedule",
    href: "/dashboard/projects/demo-project-1/schedule",
    category: "navigation",
  },
  {
    icon: IconSun,
    label: "Toggle theme",
    category: "action",
    action: "toggle-theme",
  },
  {
    icon: IconSearch,
    label: "Search files",
    category: "action",
    action: "search-files",
  },
]

const typeFilters = [
  { value: "all", label: "All" },
  { value: "navigation", label: "Navigation" },
  { value: "action", label: "Actions" },
  { value: "customer", label: "Customers" },
  { value: "vendor", label: "Vendors" },
  { value: "project", label: "Projects" },
]

const modifiedFilters = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
]

function isWithinRange(
  dateStr: string | undefined,
  range: string
): boolean {
  if (!dateStr) return range === "any"
  const date = new Date(dateStr)
  const now = new Date()
  switch (range) {
    case "today": {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return date >= start
    }
    case "week": {
      const start = new Date(now)
      start.setDate(start.getDate() - 7)
      return date >= start
    }
    case "month": {
      const start = new Date(now)
      start.setDate(start.getDate() - 30)
      return date >= start
    }
    default:
      return true
  }
}

export function MobileSearch({
  open,
  setOpen,
}: MobileSearchProps) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [query, setQuery] = React.useState("")
  const [visible, setVisible] = React.useState(false)
  const [animating, setAnimating] = React.useState(false)
  const [typeFilter, setTypeFilter] = React.useState("all")
  const [modifiedFilter, setModifiedFilter] =
    React.useState("any")
  const [activeSheet, setActiveSheet] = React.useState<
    "type" | "modified" | null
  >(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = React.useState(false)
  const [dynamicItems, setDynamicItems] = React.useState<
    SearchItem[]
  >([])
  const loadedRef = React.useRef(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setTypeFilter("all")
      setModifiedFilter("any")
      setVisible(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimating(true)
          inputRef.current?.focus()
        })
      })
      if (!loadedRef.current) {
        loadedRef.current = true
        loadEntities()
      }
    } else {
      setAnimating(false)
      const timer = setTimeout(() => setVisible(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  async function loadEntities() {
    try {
      const [customers, vendors, projects] = await Promise.all([
        getCustomers(),
        getVendors(),
        getProjects(),
      ])
      const items: SearchItem[] = [
        ...customers.map((c) => ({
          icon: IconUsers,
          label: c.name,
          sublabel: c.email || c.company || undefined,
          href: "/dashboard/customers",
          category: "customer" as const,
          createdAt: c.createdAt,
        })),
        ...vendors.map((v) => ({
          icon: IconBuildingStore,
          label: v.name,
          sublabel: v.category,
          href: "/dashboard/vendors",
          category: "vendor" as const,
          createdAt: v.createdAt,
        })),
        ...(projects as { id: string; name: string; createdAt: string }[]).map((p) => ({
          icon: IconFolder,
          label: p.name,
          href: `/dashboard/projects/${p.id}`,
          category: "project" as const,
          createdAt: p.createdAt,
        })),
      ]
      setDynamicItems(items)
    } catch {
      // static items still work
    }
  }

  React.useEffect(() => {
    if (visible) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [visible])

  function close() {
    setOpen(false)
  }

  function navigate(href: string) {
    close()
    router.push(href)
  }

  function runAction(action: string) {
    if (action === "toggle-theme") {
      setTheme(theme === "dark" ? "light" : "dark")
    }
    if (action === "search-files") {
      inputRef.current?.focus()
      return
    }
    close()
  }

  const allItems = [...staticItems, ...dynamicItems]

  const filtered = allItems.filter((item) => {
    if (
      query.trim() &&
      !item.label.toLowerCase().includes(query.toLowerCase())
    ) {
      return false
    }
    if (typeFilter !== "all" && item.category !== typeFilter) {
      return false
    }
    if (modifiedFilter !== "any") {
      // static items (nav/actions) always pass date filter
      if (
        item.category === "navigation" ||
        item.category === "action"
      ) {
        return true
      }
      if (!isWithinRange(item.createdAt, modifiedFilter)) {
        return false
      }
    }
    return true
  })

  const grouped = {
    navigation: filtered.filter(
      (i) => i.category === "navigation"
    ),
    action: filtered.filter((i) => i.category === "action"),
    customer: filtered.filter((i) => i.category === "customer"),
    vendor: filtered.filter((i) => i.category === "vendor"),
    project: filtered.filter((i) => i.category === "project"),
  }

  const hasResults = Object.values(grouped).some(
    (g) => g.length > 0
  )

  const typeLabel =
    typeFilters.find((f) => f.value === typeFilter)?.label ??
    "Type"
  const modifiedLabel =
    modifiedFilters.find((f) => f.value === modifiedFilter)
      ?.label ?? "Modified"

  if (!mounted || !visible) return null

  function renderGroup(label: string, items: SearchItem[]) {
    if (items.length === 0) return null
    return (
      <>
        <p className="px-4 py-2 text-xs font-medium text-muted-foreground">
          {label}
        </p>
        {items.map((item, i) => (
          <button
            key={`${item.category}-${item.label}-${i}`}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/50"
            onClick={() =>
              item.action
                ? runAction(item.action)
                : item.href && navigate(item.href)
            }
          >
            <item.icon className="size-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm block truncate">
                {item.label}
              </span>
              {item.sublabel && (
                <span className="text-xs text-muted-foreground block truncate">
                  {item.sublabel}
                </span>
              )}
            </div>
          </button>
        ))}
      </>
    )
  }

  const content = (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 9999,
      }}
      className={cn(
        "bg-background flex flex-col",
        "transition-all duration-200 ease-out",
        animating
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-2"
      )}
    >
      {/* search header */}
      <div className="flex items-center gap-1 px-2 h-14 border-b shrink-0">
        <button
          onClick={close}
          className={cn(
            "flex size-10 items-center justify-center",
            "rounded-full shrink-0 active:bg-muted/50"
          )}
          aria-label="Close search"
        >
          <IconArrowLeft className="size-5 text-foreground" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          className={cn(
            "flex-1 h-10 bg-transparent text-base",
            "text-foreground placeholder:text-muted-foreground",
            "outline-none"
          )}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
            className={cn(
              "flex size-10 items-center justify-center",
              "rounded-full shrink-0 active:bg-muted/50"
            )}
            aria-label="Clear search"
          >
            <IconX className="size-5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* filter chips */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b overflow-x-auto shrink-0">
        <FilterChip
          label="Type"
          value={typeFilter === "all" ? undefined : typeLabel}
          active={typeFilter !== "all"}
          onClick={() => setActiveSheet("type")}
        />
        <FilterChip
          label="Modified"
          value={
            modifiedFilter === "any"
              ? undefined
              : modifiedLabel
          }
          active={modifiedFilter !== "any"}
          onClick={() => setActiveSheet("modified")}
        />
      </div>

      {/* results */}
      <div className="flex-1 overflow-y-auto">
        {!hasResults ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No results found.
          </div>
        ) : (
          <div className="py-1">
            {renderGroup("Navigation", grouped.navigation)}
            {renderGroup("Actions", grouped.action)}
            {renderGroup("Customers", grouped.customer)}
            {renderGroup("Vendors", grouped.vendor)}
            {renderGroup("Projects", grouped.project)}
          </div>
        )}
      </div>

      {/* type filter sheet */}
      <Sheet
        open={activeSheet === "type"}
        onOpenChange={(v) => !v && setActiveSheet(null)}
      >
        <SheetContent
          side="bottom"
          className="p-0"
          showClose={false}
        >
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              Filter by type
            </SheetTitle>
          </SheetHeader>
          <div className="py-1">
            {typeFilters.map((f) => (
              <button
                key={f.value}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/50"
                onClick={() => {
                  setTypeFilter(f.value)
                  setActiveSheet(null)
                }}
              >
                <span className="text-sm flex-1">
                  {f.label}
                </span>
                {typeFilter === f.value && (
                  <IconCheck className="size-4 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* modified filter sheet */}
      <Sheet
        open={activeSheet === "modified"}
        onOpenChange={(v) => !v && setActiveSheet(null)}
      >
        <SheetContent
          side="bottom"
          className="p-0"
          showClose={false}
        >
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              Filter by date
            </SheetTitle>
          </SheetHeader>
          <div className="py-1">
            {modifiedFilters.map((f) => (
              <button
                key={f.value}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/50"
                onClick={() => {
                  setModifiedFilter(f.value)
                  setActiveSheet(null)
                }}
              >
                <span className="text-sm flex-1">
                  {f.label}
                </span>
                {modifiedFilter === f.value && (
                  <IconCheck className="size-4 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )

  return createPortal(content, document.body)
}

function FilterChip({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1",
        "rounded-full border px-3",
        "text-sm active:bg-muted/50",
        active
          ? "border-primary/30 bg-primary/5 text-foreground"
          : "bg-background text-muted-foreground"
      )}
    >
      {value ?? label}
      <svg
        className="size-3 ml-0.5"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 4.5L6 7.5L9 4.5" />
      </svg>
    </button>
  )
}
