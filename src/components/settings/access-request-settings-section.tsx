"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["access-requests"]

/** Settings > People: whether people can find this company on the Request access page. */
export function AccessRequestSettingsSection(): React.ReactElement {
  const { loaded, canEdit, error, pending, settings, save } = useFeatureSettingsEditor("access-requests", {
    savedMessage: "Access request setting saved.",
  })

  return (
    <section aria-labelledby="access-request-settings" className="space-y-3 border-b pb-6">
      <div>
        <h2 id="access-request-settings" className="text-base font-semibold">Allow access requests</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <div className="flex items-start gap-3">
          <Switch
            id="allow-access-requests"
            checked={settings.allowRequests}
            disabled={pending || !canEdit}
            onCheckedChange={(checked) => save({ allowRequests: checked })}
          />
          <div className="space-y-1">
            <Label htmlFor="allow-access-requests">List this company on the Request access page</Label>
            <p className="text-xs text-muted-foreground">
              {settings.allowRequests
                ? "On: people who sign up can choose this company and ask to join. Admins are notified of each request."
                : "Off: only people you invite can join."}
              {canEdit ? "" : " Only admins can change this."}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
