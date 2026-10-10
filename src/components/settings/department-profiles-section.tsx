"use client"

import * as React from "react"
import { toast } from "sonner"
import { checkDepartmentSendingMailbox } from "@/app/actions/department-profiles"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  BUILT_IN_DEPARTMENT_LOGOS,
  DEFAULT_DEPARTMENT_PROFILES,
  DEPARTMENT_CODES,
  departmentLogoSrc,
  type DepartmentProfile,
  type DepartmentProfiles,
} from "@/lib/department-profiles"
import { departmentProfilesSchema, FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import type { ProjectDepartment } from "@/lib/project-branding"
import { cn } from "@/lib/utils"

type TextKey = Exclude<keyof DepartmentProfile, "logoDataUrl" | "mailingAddress" | "description">

const TEXT_FIELDS: readonly { readonly key: TextKey; readonly label: string; readonly type?: "email" }[] = [
  { key: "displayName", label: "Name in Compass" },
  { key: "shortName", label: "Short name" },
  { key: "companyName", label: "Name on documents and emails" },
  { key: "legalName", label: "Legal name (with any dba)" },
  { key: "telephone", label: "Phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "licenseNumber", label: "License number" },
  { key: "officeHours", label: "Office hours" },
  { key: "senderAddress", label: "Send emails from (Workspace mailbox)", type: "email" },
  { key: "senderName", label: "Sender name" },
]

const MAX_LOGO_BYTES = 300 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unreadable file.")))
    reader.onerror = () => reject(new Error("Unreadable file."))
    reader.readAsDataURL(file)
  })
}

type MailboxCheck =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "ok"; readonly address: string }
  | { readonly kind: "failed"; readonly message: string }

/**
 * Settings → Company → Departments: each department's identity, read by
 * documents, emails, portals and print views. Only the owner-admin edits.
 */
export function DepartmentProfilesSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [profiles, setProfiles] = React.useState<DepartmentProfiles>(DEFAULT_DEPARTMENT_PROFILES)
  const [active, setActive] = React.useState<ProjectDepartment>("O")
  const [check, setCheck] = React.useState<MailboxCheck>({ kind: "idle" })
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("department-profiles")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = departmentProfilesSchema.safeParse(result.data.settings)
    setProfiles(parsed.success ? parsed.data.departments : DEFAULT_DEPARTMENT_PROFILES)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const profile = profiles[active]
  const setField = (key: keyof DepartmentProfile, value: string): void =>
    setProfiles((current) => ({ ...current, [active]: { ...current[active], [key]: value } }))

  async function chooseLogo(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.type !== "image/png") {
      toast.error("Use a PNG logo (a transparent background works best).")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Use a PNG logo under 300 KB.")
      return
    }
    try {
      setField("logoDataUrl", await readFileAsDataUrl(file))
    } catch {
      toast.error("That file couldn't be read.")
    }
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings("department-profiles", { departments: profiles })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Department profiles saved.")
      setCheck({ kind: "idle" })
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("department-profiles")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Department profiles reset to the built-in defaults.")
      await load()
    })
  }

  function checkMailbox(): void {
    setCheck({ kind: "checking" })
    void checkDepartmentSendingMailbox(active).then((result) =>
      setCheck(result.success ? { kind: "ok", address: result.data.address } : { kind: "failed", message: result.error }),
    )
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="department-profiles-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="department-profiles-settings" className="text-base font-semibold">{FEATURE_SETTINGS["department-profiles"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["department-profiles"].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-5">
          <div role="tablist" aria-label="Department" className="flex flex-wrap border-b">
            {DEPARTMENT_CODES.map((code) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={active === code}
                onClick={() => {
                  setActive(code)
                  setCheck({ kind: "idle" })
                }}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  active === code ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {profiles[code].shortName || code}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- logos are data URLs or static files */}
            <img
              src={departmentLogoSrc(active, profile)}
              alt={`${profile.companyName} logo`}
              className="size-16 border bg-background object-contain p-1"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="department-logo">Logo</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input id="department-logo" type="file" accept="image/png" disabled={disabled} onChange={(event) => void chooseLogo(event)} className="h-9 max-w-64" />
                {profile.logoDataUrl && canEdit ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setField("logoDataUrl", "")}>
                    Use the built-in logo
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG under 300 KB. {profile.logoDataUrl ? "Custom logo." : `Built-in: ${BUILT_IN_DEPARTMENT_LOGOS[active].split("/").pop() ?? ""}`}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`department-${field.key}`}>{field.label}</Label>
                <Input
                  id={`department-${field.key}`}
                  type={field.type ?? "text"}
                  value={profile[field.key]}
                  disabled={disabled}
                  onChange={(event) => setField(field.key, event.target.value)}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="department-mailingAddress">Mailing address</Label>
              <Textarea
                id="department-mailingAddress"
                rows={3}
                value={profile.mailingAddress}
                disabled={disabled}
                onChange={(event) => setField("mailingAddress", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="department-description">Description</Label>
              <Textarea
                id="department-description"
                rows={3}
                value={profile.description}
                disabled={disabled}
                onChange={(event) => setField("description", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-y py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={checkMailbox} disabled={check.kind === "checking"}>
                {check.kind === "checking" ? "Checking…" : "Check sending mailbox"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Asks Google whether Compass may send as this department&apos;s saved mailbox. Nothing is sent.
              </span>
            </div>
            {check.kind === "ok" ? (
              <p role="status" className="text-sm text-primary">Compass can send as {check.address}.</p>
            ) : check.kind === "failed" ? (
              <p role="alert" className="text-sm text-destructive">{check.message}</p>
            ) : null}
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
              <p className="text-xs text-muted-foreground">Only the company owner can change department profiles.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
