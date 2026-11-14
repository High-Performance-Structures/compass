"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  EMAIL_SENDER_VERIFICATION_MODE_LABELS,
  EMAIL_SENDER_VERIFICATION_MODES,
  type EmailSenderVerificationMode,
} from "@/lib/feature-settings/email-sender-verification-settings"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["email-sender-verification"]

function isMode(value: string): value is EmailSenderVerificationMode {
  return EMAIL_SENDER_VERIFICATION_MODES.some((mode) => mode === value)
}

/** Settings > Workflows: whether job emails must pass Gmail's sender check before their sender is trusted. */
export function EmailSenderVerificationSettingsSection(): React.ReactElement {
  const { loaded, canEdit, error, pending, settings, save } = useFeatureSettingsEditor("email-sender-verification", {
    savedMessage: "Email sender verification saved.",
  })

  return (
    <section aria-labelledby="email-sender-verification" className="space-y-3 border-b pb-6">
      <div>
        <h2 id="email-sender-verification" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <RadioGroup
          value={settings.mode}
          disabled={pending || !canEdit}
          className="max-w-2xl space-y-3"
          onValueChange={(next) => { if (isMode(next)) save({ ...settings, mode: next }) }}
        >
          {EMAIL_SENDER_VERIFICATION_MODES.map((mode) => (
            <div key={mode} className="flex items-start gap-3">
              <RadioGroupItem id={`email-sender-verification-${mode}`} value={mode} className="mt-0.5" />
              <div className="space-y-0.5">
                <Label htmlFor={`email-sender-verification-${mode}`}>{EMAIL_SENDER_VERIFICATION_MODE_LABELS[mode].label}</Label>
                <p className="text-xs text-muted-foreground">{EMAIL_SENDER_VERIFICATION_MODE_LABELS[mode].description}</p>
              </div>
            </div>
          ))}
        </RadioGroup>
      ) : null}
      {loaded && !canEdit ? <p className="text-xs text-muted-foreground">Only admins can change this.</p> : null}
    </section>
  )
}
