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

  return (
    <Collapsible
      asChild
      key={`${item.title}-${hasActiveItem ? "active" : "inactive"}`}
      defaultOpen={hasActiveItem}
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
        <CollapsibleContent>
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
        </CollapsibleContent>
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

  return (
    <Collapsible
      asChild
      key={`${item.title}-${hasActiveItem ? "active" : "inactive"}`}
      defaultOpen={hasActiveItem}
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
        <CollapsibleContent>
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
        </CollapsibleContent>
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
