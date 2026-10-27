"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { FEATURE_SETTINGS, type MessageDeskSettings } from "@/lib/feature-settings/registry"
import { ProjectAgingSettingsSection } from "@/components/settings/project-aging-settings-section"
import { PortfolioMapSettingsSection } from "@/components/settings/portfolio-map-settings-section"
import { WeatherAlertSettingsSection } from "@/components/settings/weather-alert-settings-section"
import { LinkedJobSettingsSection } from "@/components/settings/linked-job-settings-section"
import { SquareAlertSettingsSection } from "@/components/settings/square-alert-settings-section"
import { EstimateSettingsSection } from "@/components/settings/estimate-settings-section"
import { ContractDepositSettingsSection } from "@/components/settings/contract-deposit-settings-section"
import { PayApplicationSettingsSection } from "@/components/settings/pay-application-settings-section"
import { ScheduleConflictSettingsSection } from "@/components/settings/schedule-conflict-settings-section"
import { FieldCostCodeEditor } from "@/components/settings/field-cost-code-editor"
import { DailyLogSettingsSection } from "@/components/settings/daily-log-settings-section"
import { DailyLogFollowUpSettingsSection } from "@/components/settings/daily-log-followup-settings-section"
import { ProjectTimelineSettingsSection } from "@/components/settings/project-timeline-settings-section"
import { DailyLogReminderSettingsSection } from "@/components/settings/daily-log-reminder-settings-section"
import { ClientInteractionSettingsSection } from "@/components/settings/client-interaction-settings-section"
import { ClientFollowUpSettingsSection } from "@/components/settings/client-follow-up-settings-section"
import { NuTechEmailSettingsSection } from "@/components/settings/nutech-email-settings-section"
import { BracingRentalSettingsSection } from "@/components/settings/bracing-rental-settings-section"
import { ArchiveDeliverySettingsSection } from "@/components/settings/archive-delivery-settings"
import { PaperTrailSettingsSection } from "@/components/settings/paper-trail-settings-section"
import { MyCompassCalendarSettingsSection } from "@/components/settings/my-compass-calendar-settings-section"
import { MorningPlanSettingsSection } from "@/components/settings/morning-plan-settings-section"
import { ProjectCalendarSettingsSection } from "@/components/settings/project-calendar-settings-section"
import { ShopTicketSettingsSection } from "@/components/settings/shop-ticket-settings-section"
import { JobWorkflowSettingsSection } from "@/components/settings/job-workflow-settings-section"
import { JobEmailSettingsSection } from "@/components/settings/job-email-settings-section"
import { ProjectDuplicateSettingsSection } from "@/components/settings/project-duplicate-settings-section"

const DEFAULTS = FEATURE_SETTINGS["message-desk"].defaults

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function DaysField({
  id,
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  readonly id: string
  readonly label: string
  readonly help: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}): React.ReactElement {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" inputMode="decimal" min={0.25} step={0.5} value={value} disabled={disabled}
          onChange={(event) => onChange(event.target.value)} className="h-9 w-20 tabular-nums" />
        <span className="text-xs text-muted-foreground">days</span>
      </div>
    </div>
  )
}

/** Message Desk follow-up rules: aging thresholds and stale reminders. */
function MessageDeskSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [firstResponse, setFirstResponse] = React.useState(String(DEFAULTS.firstResponseDays))
  const [aging, setAging] = React.useState(String(DEFAULTS.agingDays))
  const [stale, setStale] = React.useState(String(DEFAULTS.staleDays))
  const [remind, setRemind] = React.useState(DEFAULTS.remindOnStale)
  const [pending, startTransition] = React.useTransition()

  const apply = React.useCallback((settings: Readonly<Record<string, unknown>>) => {
    setFirstResponse(String(readNumber(settings.firstResponseDays, DEFAULTS.firstResponseDays)))
    setAging(String(readNumber(settings.agingDays, DEFAULTS.agingDays)))
    setStale(String(readNumber(settings.staleDays, DEFAULTS.staleDays)))
    setRemind(typeof settings.remindOnStale === "boolean" ? settings.remindOnStale : DEFAULTS.remindOnStale)
  }, [])

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("message-desk")
    if (!result.success) {
      setError(result.error)
      return
    }
    apply(result.data.settings)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [apply])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const value: MessageDeskSettings = {
      firstResponseDays: Number(firstResponse),
      agingDays: Number(aging),
      staleDays: Number(stale),
      remindOnStale: remind,
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("message-desk", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Message Desk settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("message-desk")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Message Desk settings reset to defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="message-desk-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="message-desk-settings" className="text-base font-semibold">{FEATURE_SETTINGS["message-desk"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["message-desk"].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <DaysField id="desk-first-response" label="Needs first response" help="A new message with no response after this long."
            value={firstResponse} onChange={setFirstResponse} disabled={disabled} />
          <DaysField id="desk-aging" label="Aging" help="An open message with no follow-up for this long."
            value={aging} onChange={setAging} disabled={disabled} />
          <DaysField id="desk-stale" label="Stale (red)" help="An open message with no follow-up for this long. Must be longer than Aging."
            value={stale} onChange={setStale} disabled={disabled} />
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="desk-remind">Remind the assignee when a message goes stale</Label>
              <p className="text-xs text-muted-foreground">Sends a notification and turns their Message Desk link and bell red.</p>
            </div>
            <Switch id="desk-remind" checked={remind} onCheckedChange={setRemind} disabled={disabled} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? (
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
            <p className="ml-auto text-xs text-muted-foreground">
              Defaults: {DEFAULTS.firstResponseDays}, {DEFAULTS.agingDays} and {DEFAULTS.staleDays} business days.
            </p>
          </div>
        </form>
      ) : null}
    </section>
  )
}

/** Price sheets live on their own page; Settings links to it so admins can find it. */
function NuTechCatalogLink(): React.ReactElement {
  return (
    <section aria-labelledby="nutech-catalog-settings" className="flex flex-wrap items-center justify-between gap-3 border-b pb-6">
      <div>
        <h2 id="nutech-catalog-settings" className="text-base font-semibold">Nu-Tech product catalog</h2>
        <p className="text-sm text-muted-foreground">
          Import the published price sheets, activate a catalog version, and map products to Sage cost codes.
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href="/dashboard/nutech/catalog">Open product catalog →</Link>
      </Button>
    </section>
  )
}

const WORKFLOW_AREAS = [
  { value: "job-workflows", label: "Job workflows", description: "Steps and checklists on each department's job overview." },
  { value: "field-cost-codes", label: "Field Mode cost codes", description: "Default codes for crews, with explicit project additions." },
  { value: "daily-logs", label: "Daily logs", description: "Required fields, cost codes, to-dos and client contact on logs, and missing log reminders." },
  { value: "project-timeline", label: "Project timeline", description: "What each job's Overview shows under What's happening." },
  { value: "schedule-conflicts", label: "Schedule conflicts", description: "Crews or companies never flagged as double-booked, and other spellings of the same name." },
  { value: "estimates", label: "Estimates", description: "One contract estimate per job, or several at once, by department." },
  { value: "contract-deposits", label: "Contract deposits", description: "Whether received deposits are applied to new pay applications automatically." },
  { value: "pay-applications", label: "Pay applications", description: "How much detail clients see on a pay application: division percent, division or cost code." },
  { value: "square-payments", label: "Square and Sage payments", description: "Who is alerted about the Square connection and Square payments that need attention in Sage." },
  { value: "linked-jobs", label: "Linked jobs", description: "Shortcuts for creating a linked job in another department for the same customer and site." },
  { value: "job-emails", label: "Job emails", description: "Emails offered on HPS, ORC and Design job overviews." },
  { value: "message-desk", label: "Message Desk", description: "Response times, aging and stale reminders." },
  { value: "project-aging", label: "Project aging", description: "When client follow-ups turn due and overdue." },
  { value: "portfolio-map", label: "Portfolio map", description: "Which job statuses and departments appear on the dashboard map, and in which phase." },
  { value: "weather-alerts", label: "Weather & fire alerts", description: "Snow, rain, wind, cold, heat and wildfire distance that flag a job on the map's Weather and Fire & smoke layers." },
  { value: "client-interactions", label: "Client interactions", description: "How client contact is logged." },
  { value: "project-duplicates", label: "Duplicate project check", description: "Departments whose customers place repeat orders." },
  { value: "client-follow-up", label: "Client follow-up", description: "Follow-up cadence for clients." },
  { value: "nutech-catalog", label: "Nu-Tech product catalog", description: "Price sheets and cost code mapping." },
  { value: "nutech-emails", label: "Nu-Tech emails", description: "Order and quote email templates." },
  { value: "bracing-rentals", label: "Bracing rentals", description: "Rental equipment, owned counts, daily rate and deposit rules." },
  { value: "archive-delivery", label: "Buildertrend Archive delivery", description: "Private archive delivery and excluded internal master folders." },
  { value: "paper-trail", label: "Project paper trail", description: "Which records are saved as PDFs in project Drive folders." },
  { value: "my-compass-calendar", label: "My Compass calendar", description: "Each staff member's Google calendar of their assigned schedule items and to-dos." },
  { value: "morning-plan", label: "Today's plan and workload", description: "Each staff member's daily plan on the dashboard, and warnings when a week is over capacity." },
  { value: "project-calendars", label: "Project calendars", description: "A staff-only Google calendar for each job with its schedule, events and client meetings." },
  { value: "shop-tickets", label: "Shop tickets", description: "Ticket numbering and letterhead." },
] as const

type WorkflowArea = (typeof WORKFLOW_AREAS)[number]["value"]

function isWorkflowArea(value: string | null): value is WorkflowArea {
  return WORKFLOW_AREAS.some((area) => area.value === value)
}

const WORKFLOW_AREA_OPTIONS = WORKFLOW_AREAS.map((area) => ({
  value: area.value,
  label: area.label,
  description: area.description,
  keywords: area.description,
}))

function WorkflowAreaSection({ area }: { readonly area: WorkflowArea }): React.ReactElement {
  switch (area) {
    case "job-workflows":
      return <JobWorkflowSettingsSection />
    case "job-emails":
      return <JobEmailSettingsSection />
    case "message-desk":
      return <MessageDeskSettingsSection />
    case "project-aging":
      return <ProjectAgingSettingsSection />
    case "portfolio-map":
      return <PortfolioMapSettingsSection />
    case "weather-alerts":
      return <WeatherAlertSettingsSection />
    case "linked-jobs":
      return <LinkedJobSettingsSection />
    case "square-payments":
      return <SquareAlertSettingsSection />
    case "estimates":
      return <EstimateSettingsSection />
    case "contract-deposits":
      return <ContractDepositSettingsSection />
    case "pay-applications":
      return <PayApplicationSettingsSection />
    case "schedule-conflicts":
      return <ScheduleConflictSettingsSection />
    case "project-timeline":
      return <ProjectTimelineSettingsSection />
    case "field-cost-codes":
      return <FieldCostCodeEditor scope="company" />
    case "daily-logs":
      return (
        <>
          <DailyLogSettingsSection />
          <DailyLogFollowUpSettingsSection />
          <DailyLogReminderSettingsSection />
        </>
      )
    case "client-interactions":
      return <ClientInteractionSettingsSection />
    case "project-duplicates":
      return <ProjectDuplicateSettingsSection />
    case "client-follow-up":
      return <ClientFollowUpSettingsSection />
    case "nutech-catalog":
      return <NuTechCatalogLink />
    case "nutech-emails":
      return <NuTechEmailSettingsSection />
    case "bracing-rentals":
      return <BracingRentalSettingsSection />
    case "archive-delivery":
      return <ArchiveDeliverySettingsSection />
    case "paper-trail":
      return <PaperTrailSettingsSection />
    case "my-compass-calendar":
      return <MyCompassCalendarSettingsSection />
    case "project-calendars":
      return <ProjectCalendarSettingsSection />
    case "morning-plan":
      return <MorningPlanSettingsSection />
    case "shop-tickets":
      return <ShopTicketSettingsSection />
  }
}

/**
 * Company workflow rules, one area at a time. The chosen area is kept in the
 * URL (?workflow=…) so links and reloads open the same area.
 */
export function WorkflowsTab(): React.ReactElement {
  const [area, setArea] = React.useState<WorkflowArea>("job-workflows")

  React.useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("workflow")
    if (isWorkflowArea(requested)) setArea(requested)
  }, [])

  function choose(value: string): void {
    if (!isWorkflowArea(value)) return
    setArea(value)
    const url = new URL(window.location.href)
    url.searchParams.set("section", "workflows")
    url.searchParams.set("workflow", value)
    window.history.replaceState(null, "", url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 border-b pb-4">
        <Label htmlFor="workflow-area">Work on</Label>
        <SearchableCombobox
          id="workflow-area"
          ariaLabel="Work on"
          placeholder="Choose a workflow"
          searchPlaceholder="Search workflows..."
          className="w-full sm:w-80"
          value={area}
          options={WORKFLOW_AREA_OPTIONS}
          onValueChange={choose}
        />
      </div>
      <WorkflowAreaSection area={area} />
    </div>
  )
}
