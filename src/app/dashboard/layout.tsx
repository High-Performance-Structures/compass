export const dynamic = "force-dynamic"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { MobileBottomNav } from "@/components/mobile-bottom-nav"
import { CommandMenuProvider } from "@/components/command-menu-provider"
import { SettingsProvider } from "@/components/settings-provider"
import { FeedbackWidget } from "@/components/feedback-widget"
import { PageActionsProvider } from "@/components/page-actions-provider"
import { NavigationProgress } from "@/components/navigation-progress"
import { Toaster } from "@/components/ui/sonner"
import { ChatPanelShell } from "@/components/agent/chat-panel-shell"
import { MainContent } from "@/components/agent/main-content"
import { ChatProvider } from "@/components/agent/chat-provider"
import { ConversationPanelProvider } from "@/components/conversations/conversation-panel-provider"
import { ConversationPanelShell } from "@/components/conversations/conversation-panel-shell"
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
import { PresenceProvider } from "@/contexts/presence-context"
import { DemoBanner } from "@/components/demo/demo-banner"
import { isDemoUser } from "@/lib/demo"
import {
  canUseAskCompass,
  canUseExecutiveAdmin,
  canUseFieldDesk,
  canUseOfficeTalk,
  canPrepareGreetingCards,
  canManageUserAccess,
  canManageProjectRegistry,
} from "@/lib/permissions"
import { getQuickAddProjects } from "@/lib/quick-add-server"
import { QuickAddProvider } from "@/components/quick-add-menu"
import { isInternalStaffRole } from "@/lib/user-roles"
import { DeveloperModeProvider } from "@/components/developer-mode-provider"
import {
  DEVELOPER_MODE_COOKIE,
  developerModeFromCookie,
} from "@/lib/developer-mode"
import { ReleaseStageLabel } from "@/components/release-stage-label"

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
  const canViewActivity = authUser
    ? isInternalStaffRole(authUser.role)
    : false
  const canUseDirectMessages = canViewActivity
  const canManageFeedback = canManageUserAccess(authUser)
  const canAccessExecutiveAdmin = canUseExecutiveAdmin(authUser)
  const canAccessGreetingCards = canPrepareGreetingCards(authUser)
  const canUseDeveloperMode = canManageProjectRegistry(authUser)
  const quickAddProjects = await getQuickAddProjects(authUser, projectList)
  const developerModeEnabled = developerModeFromCookie(
    cookieStore.get(DEVELOPER_MODE_COOKIE)?.value,
    canUseDeveloperMode,
  )
  const offlineScopeKey =
    authUser?.organizationId && authUser.id
      ? `${authUser.organizationId}:${authUser.id}`
      : null

  return (
    <DeveloperModeProvider
      canUseDeveloperMode={canUseDeveloperMode}
      initialEnabled={developerModeEnabled}
    >
    <ChatProvider
      enabled={canUseCompassAgent}
      offlineScopeKey={offlineScopeKey}
      canSubmitCherish={canUseCompassFieldDesk}
    >
    <ConversationPanelProvider enabled={canUseDirectMessages}>
    <PresenceProvider>
    <VoiceProvider>
    <SettingsProvider>
    <ProjectListProvider projects={projectList}>
    <QuickAddProvider projects={quickAddProjects}>
    <PageActionsProvider>
    <CommandMenuProvider canUseAskCompass={canUseCompassAgent}>
      <BiometricGuard userId={authUser?.id}>
      <DesktopShell>
      <FeedbackWidget>
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
          user={user}
          activeOrgId={activeOrgId}
          activeOrgName={activeOrgName}
          canUseFieldDesk={canUseCompassFieldDesk}
          canViewActivity={canViewActivity}
          canManageFeedback={canManageFeedback}
          canUseExecutiveAdmin={canAccessExecutiveAdmin}
          canPrepareGreetingCards={canAccessGreetingCards}
        />
        <SidebarInset className="overflow-hidden">
          <DesktopOfflineBanner />
          <OfflineBanner />
          <DemoBanner isDemo={isDemo} />
          <SiteHeader
            user={user}
            canUseAskCompass={canUseCompassAgent}
            canUseOfficeTalk={canUseCompassOfficeTalk}
            canUseDirectMessages={canUseDirectMessages}
          />
          <NavigationProgress />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <MainContent>
              {children}
            </MainContent>
            {canUseCompassAgent && <ChatPanelShell />}
            {canUseDirectMessages && <ConversationPanelShell />}
          </div>
        </SidebarInset>
        <MobileBottomNav canUseFieldDesk={canUseCompassFieldDesk} />
        <NativeShell />
        <PushNotificationRegistrar />
        <ReleaseStageLabel />
        <Toaster position="bottom-right" />
      </SidebarProvider>
      </FeedbackWidget>
      </DesktopShell>
      </BiometricGuard>
    </CommandMenuProvider>
    </PageActionsProvider>
    </QuickAddProvider>
    </ProjectListProvider>
    </SettingsProvider>
    </VoiceProvider>
    </PresenceProvider>
    </ConversationPanelProvider>
    </ChatProvider>
    </DeveloperModeProvider>
  )
}
