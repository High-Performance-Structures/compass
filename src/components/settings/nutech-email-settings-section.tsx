"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { checkNuTechSendingMailbox } from "@/app/actions/nutech-emails"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FEATURE_SETTINGS, nuTechEmailSettingsSchema, type NuTechEmailSettings } from "@/lib/feature-settings/registry"
import { NUTECH_EMAIL_MERGE_FIELDS, NUTECH_EMAIL_TEMPLATES } from "@/lib/nutech/email-templates"

type DetailKey = Exclude<keyof NuTechEmailSettings, "templates">

const DETAIL_FIELDS: readonly { readonly key: DetailKey; readonly label: string; readonly placeholder: string; readonly type?: "email" }[] = [
  { key: "senderAddress", label: "Send from (Workspace mailbox)", placeholder: "orders@example.com", type: "email" },
  { key: "senderName", label: "Sender name", placeholder: "Company Orders" },
  { key: "officePhone", label: "Office phone", placeholder: "719-555-0100" },
  { key: "officeHours", label: "Office hours", placeholder: "8:00 am – 4:00 pm" },
  { key: "manufacturerOrdersEmail", label: "Manufacturer orders email", placeholder: "orders@manufacturer.com", type: "email" },
  { key: "manufacturerCcEmail", label: "Manufacturer rep (cc)", placeholder: "rep@manufacturer.com", type: "email" },
  { key: "dealerAccountNumber", label: "Dealer account number", placeholder: "123456" },
  { key: "warehouseName", label: "Pickup warehouse", placeholder: "Warehouse name" },
  { key: "warehouseAddress", label: "Warehouse address", placeholder: "Street, city, state ZIP" },
  { key: "warehousePhone", label: "Warehouse shipping phone", placeholder: "719-555-0101" },
  { key: "warehouseEmail", label: "Warehouse shipping email", placeholder: "shipping@warehouse.com", type: "email" },
  { key: "warehouseDockHours", label: "Dock appointment hours", placeholder: "8 am – 3 pm" },
]

type TemplateText = { readonly subject: string; readonly body: string }

function builtIn(id: string): TemplateText {
  const template = NUTECH_EMAIL_TEMPLATES.find((entry) => entry.id === id)
  return { subject: template?.subject ?? "", body: template?.body ?? "" }
}

/**
 * Nu-Tech email settings: the sending mailbox, the outside parties' details
 * the templates fill in, and each template's wording. Same load / save /
 * reset pattern as the other Workflows sections; admins edit.
 */
export function NuTechEmailSettingsSection(): React.ReactElement {
  const defaults = FEATURE_SETTINGS["nutech-emails"].defaults
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState<Readonly<Record<DetailKey, string>>>(defaults)
  const [templates, setTemplates] = React.useState<Readonly<Record<string, TemplateText>>>({})
  const [pending, startTransition] = React.useTransition()
  const [mailboxCheck, setMailboxCheck] = React.useState<
    { readonly kind: "idle" } | { readonly kind: "checking" } | { readonly kind: "ok"; readonly address: string } | { readonly kind: "failed"; readonly message: string }
  >({ kind: "idle" })

  function checkMailbox(): void {
    setMailboxCheck({ kind: "checking" })
    void checkNuTechSendingMailbox().then((result) =>
      setMailboxCheck(result.success ? { kind: "ok", address: result.data.address } : { kind: "failed", message: result.error }),
    )
  }

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("nutech-emails")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = nuTechEmailSettingsSchema.safeParse(result.data.settings)
    const settings = parsed.success ? parsed.data : FEATURE_SETTINGS["nutech-emails"].defaults
    const { templates: stored, ...rest } = settings
    setDetails(rest)
    setTemplates(Object.fromEntries(NUTECH_EMAIL_TEMPLATES.map((template) => [template.id, stored[template.id] ?? builtIn(template.id)])))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // Store only templates whose wording differs from the built-in text.
    const changed: NuTechEmailSettings["templates"] = {}
    for (const template of NUTECH_EMAIL_TEMPLATES) {
      const text = templates[template.id]
      if (!text) continue
      const original = builtIn(template.id)
      if (text.subject !== original.subject || text.body !== original.body) changed[template.id] = text
    }
    const value: NuTechEmailSettings = { ...details, templates: changed }
    startTransition(async () => {
      const result = await saveFeatureSettings("nutech-emails", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech email settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("nutech-emails")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech email settings reset.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="nutech-email-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="nutech-email-settings" className="text-base font-semibold">{FEATURE_SETTINGS["nutech-emails"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["nutech-emails"].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {DETAIL_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`nutech-setting-${field.key}`}>{field.label}</Label>
                <Input
                  id={`nutech-setting-${field.key}`}
                  type={field.type ?? "text"}
                  value={details[field.key]}
                  placeholder={field.placeholder}
                  disabled={disabled}
                  onChange={(event) => setDetails((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-y py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={checkMailbox} disabled={mailboxCheck.kind === "checking"}>
                {mailboxCheck.kind === "checking" ? "Checking…" : "Check sending mailbox"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Asks Google whether Compass may send as the saved mailbox. Nothing is sent.
              </span>
            </div>
            {mailboxCheck.kind === "ok" ? (
              <p role="status" className="text-sm text-primary">Compass can send as {mailboxCheck.address}.</p>
            ) : mailboxCheck.kind === "failed" ? (
              <p role="alert" className="text-sm text-destructive">{mailboxCheck.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Templates</h3>
            <p className="text-xs text-muted-foreground">
              Merge fields fill in from the job:{" "}
              {NUTECH_EMAIL_MERGE_FIELDS.map((field) => `{{${field.name}}}`).join(" ")}
            </p>
            {NUTECH_EMAIL_TEMPLATES.map((template) => {
              const text = templates[template.id] ?? builtIn(template.id)
              const original = builtIn(template.id)
              const changed = text.subject !== original.subject || text.body !== original.body
              return (
                <details key={template.id} className="border-b py-2">
                  <summary className="cursor-pointer text-sm">
                    {template.label}
                    {changed ? <span className="ml-2 text-xs text-primary">Custom</span> : null}
                  </summary>
                  <div className="mt-2 space-y-2">
                    <Input
                      aria-label={`${template.label} subject`}
                      value={text.subject}
                      disabled={disabled}
                      onChange={(event) =>
                        setTemplates((current) => ({ ...current, [template.id]: { ...text, subject: event.target.value } }))
                      }
                    />
                    <Textarea
                      aria-label={`${template.label} message`}
                      value={text.body}
                      rows={10}
                      disabled={disabled}
                      onChange={(event) =>
                        setTemplates((current) => ({ ...current, [template.id]: { ...text, body: event.target.value } }))
                      }
                    />
                    {changed && canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setTemplates((current) => ({ ...current, [template.id]: original }))}
                      >
                        Use the built-in wording
                      </Button>
                    ) : null}
                  </div>
                </details>
              )
            })}
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
          </div>
        </form>
      ) : null}
    </section>
  )
}
