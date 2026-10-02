"use client"

import * as React from "react"
import { IconChevronRight, type Icon } from "@tabler/icons-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useConversationPanelOptional } from "@/components/conversations/conversation-panel-provider"

export interface NavLinkItem {
  readonly kind: "link"
  readonly title: string
  readonly url: string
  readonly icon?: Icon
}

export interface NavGroupItem {
  readonly kind: "group"
  readonly title: string
  readonly icon: Icon
  readonly items: ReadonlyArray<NavGroupChildItem>
}

export interface NavSubgroupItem {
  readonly kind: "subgroup"
  readonly title: string
  readonly icon: Icon
  readonly items: ReadonlyArray<NavSubgroupChildItem>
}

export interface NavComingSoonItem {
  readonly kind: "coming-soon"
  readonly title: string
  readonly note: string
  readonly icon: Icon
}

export type NavSubgroupChildItem = NavLinkItem | NavComingSoonItem
export type NavGroupChildItem = NavLinkItem | NavSubgroupItem
export type NavItem = NavLinkItem | NavGroupItem

interface SearchParamsReader {
  readonly get: (name: string) => string | null
}

export function shouldOpenConversationPanel(title: string, panelAvailable: boolean): boolean {
  return title === "Conversations" && panelAvailable
}

function navigationItemMatches(
  item: NavLinkItem,
  pathname: string,
  searchParams: SearchParamsReader,
): boolean {
  const target = new URL(item.url, "https://compass.local")

  // The dashboard is the navigation root, not the parent of every dashboard page.
  if (target.pathname === "/dashboard") return pathname === target.pathname

  if (
    pathname !== target.pathname &&
    !pathname.startsWith(`${target.pathname}/`)
  ) {
    return false
  }

  for (const [name, value] of target.searchParams) {
    if (searchParams.get(name) !== value) return false
  }

  return true
}

function navigationItemSpecificity(item: NavLinkItem): number {
  const target = new URL(item.url, "https://compass.local")
  return target.pathname.length + Array.from(target.searchParams).length * 1_000
}

export function getActiveNavItemUrl(
  items: ReadonlyArray<NavLinkItem>,
  pathname: string,
  searchParams: SearchParamsReader,
): string | null {
  let activeItem: NavLinkItem | null = null

  for (const item of items) {
    if (!navigationItemMatches(item, pathname, searchParams)) continue
    if (
      activeItem === null ||
      navigationItemSpecificity(item) > navigationItemSpecificity(activeItem)
    ) {
      activeItem = item
    }
  }

  return activeItem?.url ?? null
}

function flattenNavLinks(
  items: ReadonlyArray<NavGroupChildItem>,
): ReadonlyArray<NavLinkItem> {
  return items.flatMap((item) => {
    if (item.kind === "link") return [item]
    return item.items.filter((child) => child.kind === "link")
  })
}

function NavLink({
  item,
  isActive,
  nested = false,
}: {
  readonly item: NavLinkItem
  readonly isActive: boolean
  readonly nested?: boolean
}) {
  const conversationPanel = useConversationPanelOptional()
  const opensPanel = shouldOpenConversationPanel(
    item.title,
    conversationPanel !== null,
  )
  const content = (
    <>
      {item.icon && <item.icon />}
      <span>{item.title}</span>
    </>
  )

  if (nested) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={isActive}>
          {opensPanel ? (
            <button type="button" onClick={() => conversationPanel?.open()}>
              {content}
            </button>
          ) : (
            <Link href={item.url}>{content}</Link>
          )}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={item.title}
        isActive={isActive}
        aria-label={item.title}
      >
        {opensPanel ? (
          <button type="button" onClick={() => conversationPanel?.open()}>
            {content}
          </button>
        ) : (
          <Link href={item.url}>{content}</Link>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const SIDEBAR_COLLAPSIBLE_DURATION = 140
const SIDEBAR_COLLAPSIBLE_OPEN_EASING = "cubic-bezier(0.16, 1, 0.3, 1)"
const SIDEBAR_COLLAPSIBLE_CLOSE_EASING = "cubic-bezier(0.7, 0, 0.84, 1)"

function AnimatedCollapsibleContent({
  open,
  children,
}: {
  readonly open: boolean
  readonly children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const mountedRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    const targetHeight = open ? node.scrollHeight : 0
    const measuredHeight = Number.parseFloat(window.getComputedStyle(node).height)
    const currentHeight = Number.isFinite(measuredHeight) ? measuredHeight : 0
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    if (
      !mountedRef.current ||
      reduceMotion ||
      Math.abs(currentHeight - targetHeight) < 0.5
    ) {
      node.style.height = open ? "auto" : "0px"
      mountedRef.current = true
      return
    }

    const animation = node.animate(
      [
        { height: `${currentHeight}px` },
        { height: `${targetHeight}px` },
      ],
      {
        duration: SIDEBAR_COLLAPSIBLE_DURATION,
        easing: open
          ? SIDEBAR_COLLAPSIBLE_OPEN_EASING
          : SIDEBAR_COLLAPSIBLE_CLOSE_EASING,
        fill: "forwards",
      },
    )

    let cancelled = false
    animation.onfinish = () => {
      if (cancelled) return
      node.style.height = open ? "auto" : "0px"
    }

    return () => {
      cancelled = true
      const interruptedHeight = Number.parseFloat(
        window.getComputedStyle(node).height,
      )
      animation.cancel()
      animation.onfinish = null
      if (Number.isFinite(interruptedHeight)) {
        node.style.height = `${interruptedHeight}px`
      }
    }
  }, [open])

  return (
    <CollapsibleContent
      forceMount
      hidden={false}
      ref={ref}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className="sidebar-collapsible-content"
    >
      {children}
    </CollapsibleContent>
  )
}

function NavSubmenu({
  item,
  activeUrl,
  header,
}: {
  readonly item: NavGroupItem
  readonly activeUrl: string | null
  readonly header?: React.ReactNode
}) {
  const { state, setOpen } = useSidebar()
  const hasActiveItem = flattenNavLinks(item.items).some(
    (child) => child.url === activeUrl,
  )

  const [open, setOpenState] = React.useState(hasActiveItem)

  return (
    <Collapsible
      asChild
      key={`${item.title}-${hasActiveItem ? "active" : "inactive"}`}
      open={open}
      onOpenChange={setOpenState}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={hasActiveItem}
            aria-label={item.title}
            onClick={() => {
              if (state === "collapsed") setOpen(true)
            }}
          >
            <item.icon />
            <span>{item.title}</span>
            <IconChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <AnimatedCollapsibleContent open={open}>
          {header}
          <SidebarMenuSub>
            {item.items.map((child) => (
              child.kind === "subgroup" ? (
                <NavNestedSubmenu
                  key={child.title}
                  item={child}
                  activeUrl={activeUrl}
                />
              ) : (
                <NavLink
                  key={child.title}
                  item={child}
                  isActive={child.url === activeUrl}
                  nested
                />
              )
            ))}
          </SidebarMenuSub>
        </AnimatedCollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function NavNestedSubmenu({
  item,
  activeUrl,
}: {
  readonly item: NavSubgroupItem
  readonly activeUrl: string | null
}) {
  const hasActiveItem = item.items.some(
    (child) => child.kind === "link" && child.url === activeUrl,
  )

  const [open, setOpenState] = React.useState(hasActiveItem)

  return (
    <Collapsible
      asChild
      key={`${item.title}-${hasActiveItem ? "active" : "inactive"}`}
      open={open}
      onOpenChange={setOpenState}
      className="group/nested-collapsible"
    >
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton asChild isActive={hasActiveItem}>
            <button type="button" aria-label={item.title}>
              <item.icon />
              <span>{item.title}</span>
              <IconChevronRight className="ml-auto transition-transform group-data-[state=open]/nested-collapsible:rotate-90" />
            </button>
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <AnimatedCollapsibleContent open={open}>
          <SidebarMenuSub className="mr-0 ml-3">
            {item.items.map((child) =>
              child.kind === "coming-soon" ? (
                <SidebarMenuSubItem key={child.title}>
                  <SidebarMenuSubButton asChild>
                    <button
                      type="button"
                      disabled
                      aria-label={`${child.title} — ${child.note}`}
                    >
                      <child.icon />
                      <span>{child.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-sidebar-foreground/60">
                        {child.note}
                      </span>
                    </button>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ) : (
                <NavLink
                  key={child.title}
                  item={child}
                  isActive={child.url === activeUrl}
                  nested
                />
              ),
            )}
          </SidebarMenuSub>
        </AnimatedCollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  )
}

export function NavMain({
  items,
  groupHeaders,
}: {
  readonly items: ReadonlyArray<NavItem>
  readonly groupHeaders?: Readonly<Record<string, React.ReactNode>>
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const links = items.flatMap((item) =>
    item.kind === "group" ? flattenNavLinks(item.items) : [item],
  )
  const activeUrl = getActiveNavItemUrl(
    links,
    pathname,
    searchParams,
  )

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) =>
            item.kind === "group" ? (
              <NavSubmenu
                key={item.title}
                item={item}
                activeUrl={activeUrl}
                header={groupHeaders?.[item.title]}
              />
            ) : (
              <NavLink
                key={item.title}
                item={item}
                isActive={item.url === activeUrl}
              />
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
