"use client"

import * as React from "react"
import { toast } from "sonner"
import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import { FEATURE_SETTINGS, jobEmailSettingsSchema, type JobEmailSettings } from "@/lib/feature-settings/registry"
import { JOB_EMAIL_MERGE_FIELDS, JOB_EMAIL_TEMPLATES, jobEmailTemplateKey, type JobEmailTemplate } from "@/lib/job-workflows/email-templates"
import type { ProjectDepartment } from "@/lib/project-branding"
import { cn } from "@/lib/utils"

const GROUP = FEATURE_SETTINGS["job-emails"]
const EMAIL_DEPARTMENTS: readonly ProjectDepartment[] = DEPARTMENT_CODES.filter((code) => (JOB_EMAIL_TEMPLATES[code]?.length ?? 0) > 0)

type Templates = JobEmailSettings["templates"]

/**
 * Settings → Workflows → Job emails: the wording of each HPS, ORC and Design
 * email. Company details fill in from Settings → Company.
 */
export function JobEmailSettingsSection(): React.ReactElement {
  const profiles = useDepartmentProfiles()
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [templates, setTemplates] = React.useState<Templates>({})
  const [active, setActive] = React.useState<ProjectDepartment>(EMAIL_DEPARTMENTS[0] ?? "H")
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("job-emails")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = jobEmailSettingsSchema.safeParse(result.data.settings)
    setTemplates(parsed.success ? parsed.data.templates : {})
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  /** Only wording that differs from the built-in text is saved. */
  function changedOnly(): Templates {
    return Object.fromEntries(
      Object.entries(templates).filter(([key, text]) => {
        const [code, id] = key.split(".")
        const builtIn = EMAIL_DEPARTMENTS.flatMap((department) =>
          department === code ? (JOB_EMAIL_TEMPLATES[department] ?? []).filter((template) => template.id === id) : [],
        )[0]
        return !builtIn || builtIn.subject !== text.subject || builtIn.body !== text.body
      }),
    )
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings("job-emails", { templates: changedOnly() })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Job emails saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("job-emails")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Job emails reset to the built-in wording.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  const editor = (template: JobEmailTemplate): React.ReactElement => {
    const key = jobEmailTemplateKey(active, template.id)
    const original = { subject: template.subject, body: template.body }
    const text = templates[key] ?? original
    const changed = text.subject !== original.subject || text.body !== original.body
    return (
      <details key={key} className="border-b py-2">
        <summary className="cursor-pointer text-sm">
          {template.label}
          <span className="ml-2 text-xs text-muted-foreground">{template.audience === "client" ? "to the client" : "to others"}</span>
          {changed ? <span className="ml-2 text-xs text-primary">Custom</span> : null}
        </summary>
        <div className="mt-2 space-y-2">
          <Input
            aria-label={`${template.label} subject`}
            value={text.subject}
            disabled={disabled}
            onChange={(event) => setTemplates((current) => ({ ...current, [key]: { ...text, subject: event.target.value } }))}
          />
          <Textarea
            aria-label={`${template.label} message`}
            value={text.body}
            rows={12}
            disabled={disabled}
            onChange={(event) => setTemplates((current) => ({ ...current, [key]: { ...text, body: event.target.value } }))}
          />
          {changed && canEdit ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setTemplates((current) => ({ ...current, [key]: original }))}>
              Use the built-in wording
            </Button>
          ) : null}
        </div>
      </details>
    )
  }

  return (
    <section aria-labelledby="job-email-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="job-email-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div role="tablist" aria-label="Department" className="flex flex-wrap border-b">
            {EMAIL_DEPARTMENTS.map((code) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={active === code}
                onClick={() => setActive(code)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  active === code ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {profiles[code].shortName}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Sent from the department&apos;s mailbox when one is set in Settings → Company, otherwise from the sender&apos;s own
            address. Merge fields fill in from the job: {JOB_EMAIL_MERGE_FIELDS.map((field) => `{{${field.name}}}`).join(" ")}
          </p>
          <div>{(JOB_EMAIL_TEMPLATES[active] ?? []).map(editor)}</div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? (
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to built-in wording</Button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change job emails.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
