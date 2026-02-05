import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { MobileBottomNav } from "@/components/mobile-bottom-nav"
import { CommandMenuProvider } from "@/components/command-menu-provider"
import { SettingsProvider } from "@/components/settings-provider"
import { FeedbackWidget } from "@/components/feedback-widget"
import { PageActionsProvider } from "@/components/page-actions-provider"
import { DashboardContextMenu } from "@/components/dashboard-context-menu"
import { Toaster } from "@/components/ui/sonner"
import { ChatPanel } from "@/components/agent/chat-panel"
import { AgentProvider } from "@/components/agent/agent-provider"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { getProjects } from "@/app/actions/projects"
import { ProjectListProvider } from "@/components/project-list-provider"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"

export default async function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [projectList, authUser] = await Promise.all([
    getProjects(),
    getCurrentUser(),
  ])
  const user = authUser ? toSidebarUser(authUser) : null

  return (
    <SettingsProvider>
    <AgentProvider>
    <ProjectListProvider projects={projectList}>
    <PageActionsProvider>
    <CommandMenuProvider>
      <SidebarProvider
        defaultOpen={false}
        className="h-screen overflow-hidden"
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" projects={projectList} user={user} />
        <FeedbackWidget>
          <SidebarInset className="overflow-hidden">
            <SiteHeader user={user} />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <DashboardContextMenu>
              <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden pb-14 md:pb-0 min-w-0">
                <div className="@container/main flex flex-1 flex-col min-w-0">
                  {children}
                </div>
              </div>
              </DashboardContextMenu>
              <ChatPanel />
            </div>
          </SidebarInset>
        </FeedbackWidget>
        <MobileBottomNav />
        <p className="pointer-events-none fixed bottom-3 left-0 right-0 hidden text-center text-xs text-muted-foreground/60 md:block">
          Pre-alpha build
        </p>
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </CommandMenuProvider>
    </PageActionsProvider>
    </ProjectListProvider>
    </AgentProvider>
    </SettingsProvider>
  )
}
