import type * as React from "react"
import {
  IconAddressBook,
  IconCalculator,
  IconClipboardCheck,
  IconClipboardText,
  IconEye,
  IconFileDollar,
  IconFileInvoice,
  IconFolderSearch,
  IconMailForward,
  IconMessageCircleQuestion,
  IconMessages,
  IconPalette,
  IconPhoto,
  IconReceipt,
  IconShieldCheck,
  IconShoppingCart,
  IconShoppingCartQuestion,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { ActiveProjectSectionRedirect } from "@/components/projects/active-project-section-redirect"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"

type ProjectTarget = {
  readonly section: string
  readonly title: string
  readonly description: string
  readonly placeholder: string
  readonly badge: string
  readonly icon: React.ReactElement
}

const TARGETS: readonly ProjectTarget[] = [
  {
    section: "owner-updates",
    title: "Owner Updates",
    description:
      "Choose a project before drafting or publishing an owner update.",
    placeholder: "Search projects for owner updates...",
    badge: "Owner update context",
    icon: <IconMailForward className="size-5 text-muted-foreground" />,
  },
  {
    section: "daily-logs",
    title: "Daily Logs",
    description: "Choose a project before reviewing field notes.",
    placeholder: "Search projects for daily logs...",
    badge: "Daily log context",
    icon: <IconClipboardText className="size-5 text-muted-foreground" />,
  },
  {
    section: "photos",
    title: "Photos",
    description: "Choose a project before reviewing photos.",
    placeholder: "Search projects for photos...",
    badge: "Photo context",
    icon: <IconPhoto className="size-5 text-muted-foreground" />,
  },
  {
    section: "videos",
    title: "Videos",
    description: "Choose a project before reviewing videos.",
    placeholder: "Search projects for videos...",
    badge: "Video context",
    icon: <IconVideo className="size-5 text-muted-foreground" />,
  },
  {
    section: "selections",
    title: "Finish Selections",
    description: "Choose a project before reviewing finish selections.",
    placeholder: "Search projects for selections...",
    badge: "Selection context",
    icon: <IconPalette className="size-5 text-muted-foreground" />,
  },
  {
    section: "estimate",
    title: "Estimates",
    description: "Choose a project before opening its estimate workspace.",
    placeholder: "Search projects for estimates...",
    badge: "Estimate context",
    icon: <IconCalculator className="size-5 text-muted-foreground" />,
  },
  {
    section: "budget",
    title: "Budget / G703",
    description: "Choose a project before opening budget detail.",
    placeholder: "Search projects for budget...",
    badge: "Budget context",
    icon: <IconFileDollar className="size-5 text-muted-foreground" />,
  },
  {
    section: "financials",
    title: "Project Financials",
    description:
      "Choose a project before reviewing bills and pay applications.",
    placeholder: "Search projects for financials...",
    badge: "Financial context",
    icon: <IconReceipt className="size-5 text-muted-foreground" />,
  },
  {
    section: "contacts",
    title: "Project Contacts",
    description: "Choose a project before assigning contacts.",
    placeholder: "Search projects for contacts...",
    badge: "Contact context",
    icon: <IconAddressBook className="size-5 text-muted-foreground" />,
  },
  {
    section: "warranty",
    title: "Warranty",
    description: "Choose a project before reviewing warranty work.",
    placeholder: "Search projects for warranty...",
    badge: "Warranty context",
    icon: <IconShieldCheck className="size-5 text-muted-foreground" />,
  },
  {
    section: "rfis",
    title: "RFIs",
    description: "Choose a project before opening RFIs.",
    placeholder: "Search projects for RFIs...",
    badge: "RFI context",
    icon: <IconMessageCircleQuestion className="size-5 text-muted-foreground" />,
  },
  {
    section: "rfqs",
    title: "RFQs",
    description: "Choose a project before drafting quote requests.",
    placeholder: "Search projects for RFQs...",
    badge: "RFQ context",
    icon: <IconShoppingCartQuestion className="size-5 text-muted-foreground" />,
  },
  {
    section: "purchase-orders",
    title: "Purchase Orders",
    description: "Choose a project before reviewing purchase orders.",
    placeholder: "Search projects for purchase orders...",
    badge: "Purchase-order context",
    icon: <IconShoppingCart className="size-5 text-muted-foreground" />,
  },
  {
    section: "change-orders",
    title: "Change Orders",
    description: "Choose a project before requesting or reviewing scope changes.",
    placeholder: "Search projects for change orders...",
    badge: "Change-order context",
    icon: <IconFileInvoice className="size-5 text-muted-foreground" />,
  },
  {
    section: "schedule",
    title: "Project Schedule",
    description: "Choose a project before opening the schedule.",
    placeholder: "Search projects for schedule...",
    badge: "Schedule context",
    icon: <IconFolderSearch className="size-5 text-muted-foreground" />,
  },
  {
    section: "todos",
    title: "Project To-Dos",
    description: "Choose a project before reviewing its to-dos.",
    placeholder: "Search projects for to-dos...",
    badge: "To-do context",
    icon: <IconClipboardCheck className="size-5 text-muted-foreground" />,
  },
  {
    section: "conversations",
    title: "Project Conversations",
    description: "Choose a project before opening its conversations.",
    placeholder: "Search projects for conversations...",
    badge: "Conversation context",
    icon: <IconMessages className="size-5 text-muted-foreground" />,
  },
  {
    section: "preview/owner",
    title: "Owner Preview",
    description: "Choose a project before opening its owner-facing preview.",
    placeholder: "Search projects for owner preview...",
    badge: "Owner preview context",
    icon: <IconEye className="size-5 text-muted-foreground" />,
  },
  {
    section: "preview/sub-vendor",
    title: "Sub/Vendor Preview",
    description:
      "Choose a project before opening its subcontractor and vendor preview.",
    placeholder: "Search projects for sub/vendor preview...",
    badge: "Sub/vendor preview context",
    icon: <IconUsers className="size-5 text-muted-foreground" />,
  },
]

function targetFor(value: string | readonly string[] | undefined): ProjectTarget {
  const target = Array.isArray(value) ? value[0] : value
  return TARGETS.find((item) => item.section === target) ?? TARGETS[0]
}

export default async function ProjectSectionPickerPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly target?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const params = await searchParams
  const target = targetFor(params.target)
  const projects = await getProjects()

  return (
    <ProjectContextWatermarkShell>
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          {target.icon}
          <h1 className="text-2xl font-semibold tracking-tight">
            {target.title}
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {target.description}
        </p>
      </div>

      <section className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Project required first</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Select the job first so the work lands in the right place.
            </p>
          </div>
          <Badge variant="secondary">{target.badge}</Badge>
        </div>
      </section>

      <ActiveProjectSectionRedirect
        targetSection={target.section}
        label={`Open ${target.title}`}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Select project</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Search by project number, name, client, or accounting context.
          </p>
        </div>

        {projects.length > 0 ? (
          <div className="max-w-xl rounded-lg border bg-background p-4 shadow-sm">
            <ProjectQuickSwitcher
              projects={projects}
              targetSection={target.section}
              placeholder={target.placeholder}
              className="w-full"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Opens {target.title} for the selected project.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconFolderSearch className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">
              No projects available
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add or sync projects first.
            </p>
          </div>
        )}
      </section>
    </ProjectContextWatermarkShell>
  )
}
