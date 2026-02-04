import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { MobileBottomNav } from "@/components/mobile-bottom-nav"
import { CommandMenuProvider } from "@/components/command-menu-provider"
import { SettingsProvider } from "@/components/settings-provider"
import { FeedbackWidget } from "@/components/feedback-widget"
import { Toaster } from "@/components/ui/sonner"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { getProjects } from "@/app/actions/projects"
import { ProjectListProvider } from "@/components/project-list-provider"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const projectList = await getProjects()

  return (
    <SettingsProvider>
    <ProjectListProvider projects={projectList}>
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
        <AppSidebar variant="inset" projects={projectList} />
        <FeedbackWidget>
          <SidebarInset className="overflow-hidden">
            <SiteHeader />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-14 md:pb-0">
              <div className="@container/main flex flex-1 flex-col min-w-0">
                {children}
              </div>
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
    </ProjectListProvider>
    </SettingsProvider>
  )
}
