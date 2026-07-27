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
import { ProjectListProvider } from "@/components/project-list-provider"
import { getCurrentUser, toSidebarUser } from "@/lib/auth"
import { cookies } from "next/headers"
import { BiometricGuard } from "@/components/native/biometric-guard"
import { OfflineBanner } from "@/components/native/offline-banner"
import { NativeShell } from "@/components/native/native-shell"
import { PushNotificationRegistrar } from "@/hooks/use-native-push"
import { DesktopShell } from "@/components/desktop/desktop-shell"
import { DesktopOfflineBanner } from "@/components/desktop/offline-banner"
import { VoiceProvider } from "@/components/voice/voice-provider"
import { DemoBanner } from "@/components/demo/demo-banner"
import { isDemoUser } from "@/lib/demo"
import {
  canUseAskCompass,
  canUseFieldDesk,
  canUseOfficeTalk,
} from "@/lib/permissions"

export default async function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [projectList, authUser, cookieStore] =
    await Promise.all([
      getProjects(),
      getCurrentUser(),
      cookies(),
    ])
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"
  const user = authUser ? toSidebarUser(authUser) : null
  const activeOrgId = authUser?.organizationId ?? null
  const activeOrgName = authUser?.organizationName ?? null
  const isDemo = authUser ? isDemoUser(authUser.id) : false
  const canUseCompassAgent = canUseAskCompass(authUser)
  const canUseCompassFieldDesk = canUseFieldDesk(authUser)
  const canUseCompassOfficeTalk = canUseOfficeTalk(authUser)
  const offlineScopeKey =
    authUser?.organizationId && authUser.id
      ? `${authUser.organizationId}:${authUser.id}`
      : null

  return (
    <ChatProvider
      enabled={canUseCompassAgent}
      offlineScopeKey={offlineScopeKey}
      canSubmitCherish={canUseCompassFieldDesk}
    >
    <VoiceProvider>
    <SettingsProvider>
    <ProjectListProvider projects={projectList}>
    <PageActionsProvider>
    <CommandMenuProvider canUseAskCompass={canUseCompassAgent}>
      <BiometricGuard userId={authUser?.id}>
      <DesktopShell>
      <FeedbackWidget>
      <DashboardContextMenu>
      <SidebarProvider
        defaultOpen={sidebarOpen}
        className="h-screen overflow-hidden"
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
          } as React.CSSProperties
        }
      >
        <AppSidebar
          variant="inset"
          projects={projectList}
          user={user}
          activeOrgId={activeOrgId}
          activeOrgName={activeOrgName}
          canUseFieldDesk={canUseCompassFieldDesk}
        />
        <SidebarInset className="overflow-hidden">
          <DesktopOfflineBanner />
          <OfflineBanner />
          <DemoBanner isDemo={isDemo} />
          <SiteHeader
            user={user}
            canUseAskCompass={canUseCompassAgent}
            canUseOfficeTalk={canUseCompassOfficeTalk}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <MainContent>
              {children}
            </MainContent>
            {canUseCompassAgent && <ChatPanelShell />}
          </div>
        </SidebarInset>
        <MobileBottomNav canUseFieldDesk={canUseCompassFieldDesk} />
        <NativeShell />
        <PushNotificationRegistrar />
        <p className="pointer-events-none fixed bottom-3 left-0 right-0 hidden text-center text-xs text-muted-foreground/60 md:block">
          Pre-alpha build
        </p>
        <Toaster position="bottom-right" />
      </SidebarProvider>
      </DashboardContextMenu>
      </FeedbackWidget>
      </DesktopShell>
      </BiometricGuard>
    </CommandMenuProvider>
    </PageActionsProvider>
    </ProjectListProvider>
    </SettingsProvider>
    </VoiceProvider>
    </ChatProvider>
  )
}
