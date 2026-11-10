"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["company-email-domains"]

/** Settings → Workflows → Company email domains: the company's own domains, old ones too. */
export function CompanyEmailDomainsSettingsSection(): React.ReactElement {
  // Edited as text, one domain per line.
  const [text, setText] = React.useState("")
  const { loaded, canEdit, customized, error, pending, save: saveSettings, reset } = useFeatureSettingsEditor(
    "company-email-domains",
    {
      savedMessage: "Company email domains saved.",
      resetMessage: "Company email domains cleared.",
      onLoaded: (settings) => setText(settings.domains.join("\n"))
    },
  )

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // One domain per line; a pasted address keeps only its domain.
    const domains = [...new Set(text.split(/[\s,;]+/).map((value) => value.trim().toLowerCase().replace(/^.*@/, "")).filter(Boolean))]
    saveSettings({ domains })
  }

  return (
    <section aria-labelledby="company-email-domains-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="company-email-domains-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="company-email-domains">Domains, one per line</Label>
            <Textarea
              id="company-email-domains"
              rows={4}
              value={text}
              placeholder={"example.com\nold-name.com"}
              disabled={pending || !canEdit}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Never list a free email service such as gmail.com. Shared mailboxes on these domains (accounting@, sales@) stay for review unless a staff member lists them under Other email addresses.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Clear</Button> : null}
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
