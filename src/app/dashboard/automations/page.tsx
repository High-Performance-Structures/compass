import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconAutomation,
  IconBrandGoogleDrive,
  IconCalendarStats,
  IconClipboardText,
  IconExternalLink,
  IconFolderPlus,
  IconForms,
  IconShieldLock,
  IconTableImport,
  IconWebhook,
} from "@tabler/icons-react"

import { getCurrentUser } from "@/lib/auth"
import { canManageProjectRegistry } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { isDeveloperModeEnabled } from "@/lib/developer-mode-server"

type ScriptStatus = "google-native" | "bridge-candidate" | "retire-later"

type AutomationScript = Readonly<{
  name: string
  division: string
  status: ScriptStatus
  source: string
  scriptId: string
  webAppUrl: string | null
  summary: string
  owns: readonly string[]
  compassHandoff: string
}>

const GOOGLE_SCRIPTS: readonly AutomationScript[] = [
  {
    name: "HPS Project Manager",
    division: "All divisions",
    status: "bridge-candidate",
    source: "Developer / GoogleIntegration",
    scriptId: "1NzKjO6r_WS5optIHxwGxB5mby3PX0TSHhctU73xZIFtWXXgLueksPN-s",
    webAppUrl:
      "https://script.google.com/a/macros/hps-colorado.com/s/AKfycbyeCqsdObrPp91LRmpEHSLZ8xdGerw7ExF2mFSSzYkxGnTrliv9OvHsYOFXicnVC5nQ/exec",
    summary:
      "Searches clients and projects, creates new project numbers, creates Drive folders, adds subfolders, and updates tracker rows.",
    owns: ["Project intake", "Folder creation", "Tracker updates"],
    compassHandoff: "Posts project create/update records to Compass and stages Sage job review.",
  },
  {
    name: "HPS Project Intake Automation",
    division: "HPS",
    status: "google-native",
    source: "HPS Projects",
    scriptId: "1lURNLz1gp29Df2kMD8veaSoJQrAB4lNvRX-FtzFcbAwP8HD_vB7lJg8Z",
    webAppUrl: null,
    summary:
      "Keeps Google intake available while project review moves into Compass.",
    owns: ["Form submit trigger", "Intake handoff", "Drive-side setup"],
    compassHandoff: "Ready for /api/google/script-handoff once its trigger payload is confirmed.",
  },
  {
    name: "Nu-Tech PO Order Manager",
    division: "NuTech",
    status: "google-native",
    source: "HPS Projects",
    scriptId: "11BxRLRu6YYVbWwvlqDNlnpPlCcs3fBhq5OkKaaugfAm-mZUxkBWvxqZ5",
    webAppUrl: null,
    summary:
      "Supports NuTech order intake until Compass order tools are ready.",
    owns: ["PO intake", "Order tracking", "Google-side handoff"],
    compassHandoff: "Ready for /api/google/script-handoff and staged as a PO handoff when deployed.",
  },
  {
    name: "Finish Schedule Generator",
    division: "Design",
    status: "bridge-candidate",
    source: "Developer",
    scriptId: "1Xjes03vcZScLxnmoEfnuwghe3v-ehR0sZDklyCJF3b2J29bGQYP8_ljX",
    webAppUrl: null,
    summary:
      "Design-side finish schedule tool for selections, finish records, and project handoff references.",
    owns: ["Finish schedules", "Selections", "Design handoff"],
    compassHandoff: "Ready for /api/google/script-handoff after the deployed work URL is confirmed.",
  },
]

const WORKFLOW_LANES = [
  {
    title: "Project setup",
    icon: IconFolderPlus,
    owner: "Compass primary",
    body:
      "Compass owns project records, registry mapping, and permission decisions. Google can still create folders and templates during the transition.",
  },
  {
    title: "Form intake",
    icon: IconForms,
    owner: "Google trigger",
    body:
      "Keep form-submit triggers in Forms or Sheets, then hand results to Compass.",
  },
  {
    title: "Schedule refresh",
    icon: IconCalendarStats,
    owner: "Compass primary",
    body:
      "Compass displays and compares schedule data. Existing Sheets scripts are reference import/export helpers.",
  },
  {
    title: "Order handoff",
    icon: IconClipboardText,
    owner: "Bridge first",
    body:
      "NuTech order tools can stay in Google until order, vendor, product, and Sage handoffs are ready.",
  },
] as const

function statusLabel(status: ScriptStatus): string {
  switch (status) {
    case "google-native":
      return "Keep in Google"
    case "bridge-candidate":
      return "Bridge candidate"
    case "retire-later":
      return "Retire later"
  }
}

function statusVariant(status: ScriptStatus): "default" | "secondary" | "outline" {
  switch (status) {
    case "google-native":
      return "secondary"
    case "bridge-candidate":
      return "default"
    case "retire-later":
      return "outline"
  }
}

function scriptUrl(scriptId: string): string {
  return `https://script.google.com/d/${scriptId}/edit`
}

const GENERIC_HANDOFF_URL = "/api/google/script-handoff"

export default async function AutomationsPage() {
  const user = await getCurrentUser()
  const canManageAutomations = canManageProjectRegistry(user)
  const developerModeEnabled = await isDeveloperModeEnabled(canManageAutomations)

  if (!developerModeEnabled) redirect("/dashboard")

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              Automation Center
            </h1>
            <Badge variant="outline">Google transition layer</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Google scripts, triggers, and handoffs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/settings">
              <IconShieldLock className="size-4" />
              Settings
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/projects">
              <IconFolderPlus className="size-4" />
              Projects
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <Card className="rounded-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconAutomation className="size-5 text-muted-foreground" />
              <CardTitle>Script Inventory</CardTitle>
            </div>
            <CardDescription>
              Existing Google scripts and ownership.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {GOOGLE_SCRIPTS.map((script) => (
              <div
                key={script.scriptId}
                className="rounded-lg border bg-background p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">
                        {script.name}
                      </h2>
                      <Badge variant={statusVariant(script.status)}>
                        {statusLabel(script.status)}
                      </Badge>
                      <Badge variant="outline">{script.division}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {script.summary}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {script.webAppUrl ? (
                      <Button asChild size="sm">
                        <a
                          href={script.webAppUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <IconExternalLink className="size-4" />
                          Open work window
                        </a>
                      </Button>
                    ) : (
                      <Button disabled variant="outline" size="sm">
                        Needs web app URL
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={scriptUrl(script.scriptId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <IconExternalLink className="size-4" />
                        Open script
                      </a>
                    </Button>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Owns today
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {script.owns.map((item) => (
                        <Badge key={item} variant="outline">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Source
                    </p>
                    <p className="mt-2 text-sm">{script.source}</p>
                  </div>
                </div>
                <div className="mt-3 rounded-md border bg-muted/25 px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Compass handoff
                  </p>
                  <p className="mt-1 text-sm">{script.compassHandoff}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <IconWebhook className="size-5 text-muted-foreground" />
                <CardTitle>Placement Rule</CardTitle>
              </div>
              <CardDescription>
                Triggers stay close to their source.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <IconBrandGoogleDrive className="size-4" />
                  Google
                </div>
                <p className="mt-1">
                  Forms, Sheets, Drive folders, installable triggers, and quick
                  Google-native automation.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <IconTableImport className="size-4" />
                  Compass
                </div>
                <p className="mt-1">
                  Project registry, review queues, visibility, and Sage handoff.
                </p>
                <p className="mt-2 font-mono text-xs text-foreground">
                  {GENERIC_HANDOFF_URL}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>Workflow Lanes</CardTitle>
              <CardDescription>
                Script groups and owners.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {WORKFLOW_LANES.map((lane) => (
                <div key={lane.title} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <lane.icon className="size-4 text-muted-foreground" />
                      <p className="font-medium">{lane.title}</p>
                    </div>
                    <Badge variant="outline">{lane.owner}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {lane.body}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
