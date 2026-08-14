"use client"

import type { Icon } from "@tabler/icons-react"
import Link from "next/link"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useConversationPanelOptional } from "@/components/conversations/conversation-panel-provider"

export function shouldOpenConversationPanel(title: string, panelAvailable: boolean): boolean {
  return title === "Conversations" && panelAvailable
}

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: Icon
  }[]
}) {
  const conversationPanel = useConversationPanelOptional()

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const opensPanel = shouldOpenConversationPanel(item.title, conversationPanel !== null)

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title}>
                  {opensPanel ? (
                    <button type="button" onClick={() => conversationPanel?.open()}>
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                    </button>
                  ) : (
                    <Link href={item.url}>
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
