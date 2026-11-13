"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["client-conversations"]

/** Settings > People: whether clients on the same job see each other's client conversations. */
export function ClientConversationSettingsSection(): React.ReactElement {
  const { loaded, canEdit, error, pending, settings, save } = useFeatureSettingsEditor("client-conversations", {
    savedMessage: "Client conversation setting saved.",
  })

  return (
    <section aria-labelledby="client-conversation-settings" className="space-y-3 border-b pb-6">
      <div>
        <h2 id="client-conversation-settings" className="text-base font-semibold">Client conversations</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <div className="flex items-start gap-3">
          <Switch
            id="share-client-conversations"
            checked={settings.shareAmongClients}
            disabled={pending || !canEdit}
            onCheckedChange={(checked) => save({ ...settings, shareAmongClients: checked })}
          />
          <div className="space-y-1">
            <Label htmlFor="share-client-conversations">Clients on a job share conversations</Label>
            <p className="text-xs text-muted-foreground">
              {settings.shareAmongClients
                ? "On: every client with a login on a job sees all of that job's client conversations. They join quietly, with nothing marked unread."
                : "Off: each client sees only the conversations they were part of. Turning this off does not remove anyone already added."}
              {canEdit ? "" : " Only admins can change this."}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
