export const dynamic = "force-dynamic"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { MobileBottomNav } from "@/components/mobile-bottom-nav"
import { CommandMenuProvider } from "@/components/command-menu-provider"
import { SettingsProvider } from "@/components/settings-provider"
import { FeedbackWidget } from "@/components/feedback-widget"
import { PageActionsProvider } from "@/components/page-actions-provider"
import { DashboardContextMenu } from "@/components/dashboard-context-menu"
import { Toaster } from "@/components/ui/sonner"
import { ChatPanelShell } from "@/components/agent/chat-panel-shell"
import { MainContent } from "@/components/agent/main-content"
import { ChatProvider } from "@/components/agent/chat-provider"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { getProjects } from "@/app/actions/projects"
import { getCustomDashboards } from "@/app/actions/dashboards"
import { ProjectListProvider } from "@/components/project-list-provider"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"
import { BiometricGuard } from "@/components/native/biometric-guard"
import { OfflineBanner } from "@/components/native/offline-banner"
import { NativeShell } from "@/components/native/native-shell"
import { PushNotificationRegistrar } from "@/hooks/use-native-push"
import { PhotoCaptureModal } from "@/components/projects/photo-capture-modal"

export default async function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [projectList, authUser, dashboardResult] =
    await Promise.all([
      getProjects(),
      getCurrentUser(),
      getCustomDashboards(),
    ])
  const user = authUser ? toSidebarUser(authUser) : null
  const dashboardList = dashboardResult.success
    ? dashboardResult.data
    : []

  return (
    <SettingsProvider>
      <ChatProvider>
        <ProjectListProvider projects={projectList}>
          <PageActionsProvider>
            <CommandMenuProvider>
              <BiometricGuard>
                <SidebarProvider
                  defaultOpen={false}
                  className="h-screen overflow-hidden"
                  style={
                    {
                      "--sidebar-width": "calc(var(--spacing) * 72)",
                    } as React.CSSProperties
                  }
                >
                  <AppSidebar variant="inset" projects={projectList} dashboards={dashboardList} user={user} />
                  <FeedbackWidget>
                    <SidebarInset className="overflow-hidden">
                      <OfflineBanner />
                      <SiteHeader user={user} />
                      <div className="flex min-h-0 flex-1 overflow-hidden">
                        <DashboardContextMenu>
                          <MainContent>
                            {children}
                          </MainContent>
                        </DashboardContextMenu>
                        <ChatPanelShell />
                      </div>
                    </SidebarInset>
                  </FeedbackWidget>

                  <NativeShell />
                  <PushNotificationRegistrar />
                  <p className="pointer-events-none fixed bottom-3 left-0 right-0 hidden text-center text-xs text-muted-foreground/60 md:block">
                    Pre-alpha build
                  </p>
                  <Toaster position="bottom-right" />
                  <PhotoCaptureModal />
                </SidebarProvider>
              </BiometricGuard>
            </CommandMenuProvider>
          </PageActionsProvider>
        </ProjectListProvider>
      </ChatProvider>
    </SettingsProvider>
  )
}
