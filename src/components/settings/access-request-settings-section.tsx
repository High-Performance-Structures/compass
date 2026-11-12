"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["access-requests"]

/** One name per comma, blanks and repeats dropped. */
function namesFromText(text: string): string[] {
  const names = text.split(",").map((name) => name.trim()).filter(Boolean)
  return names.filter((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index)
}

/** Settings > People: whether people can find this company on the Request access page, and by which names. */
export function AccessRequestSettingsSection(): React.ReactElement {
  const { loaded, canEdit, error, pending, settings, save } = useFeatureSettingsEditor("access-requests", {
    savedMessage: "Access request setting saved.",
  })
  const [namesText, setNamesText] = React.useState("")
  const savedNames = settings.alsoKnownAs.join(", ")
  React.useEffect(() => setNamesText(savedNames), [savedNames])

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
            onCheckedChange={(checked) => save({ ...settings, allowRequests: checked })}
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
      {loaded && settings.allowRequests ? (
        <div className="max-w-xl space-y-1">
          <Label htmlFor="access-request-also-known-as">Also known as</Label>
          <div className="flex gap-2">
            <Input
              id="access-request-also-known-as"
              value={namesText}
              placeholder="Department names or dbas, separated by commas"
              disabled={pending || !canEdit}
              onChange={(event) => setNamesText(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending || !canEdit || namesFromText(namesText).join(", ") === savedNames}
              onClick={() => save({ ...settings, alsoKnownAs: namesFromText(namesText) })}
            >
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">People searching for any of these names find this company.</p>
        </div>
      ) : null}
    </section>
  )
}
