"use client"

import * as React from "react"

import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferenceState,
} from "@/app/actions/notifications"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useNative } from "@/hooks/use-native"
import { useBiometricAuth } from "@/hooks/use-biometric-auth"

export function PreferencesTab() {
  const [preferences, setPreferences] =
    React.useState<NotificationPreferenceState>({
      inAppEnabled: true,
      emailEnabled: true,
      pushEnabled: true,
      weeklyDigestEnabled: false,
      rfiEnabled: true,
      ownerUpdateEnabled: true,
      scheduleEnabled: true,
      poEnabled: true,
      timeZone: "America/Denver",
    })
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const native = useNative()
  const biometric = useBiometricAuth()

  React.useEffect(() => {
    let cancelled = false
    async function loadPreferences(): Promise<void> {
      const result = await getNotificationPreferences()
      if (!cancelled && result.success) {
        setPreferences(result.data)
      }
    }
    loadPreferences()
    return () => {
      cancelled = true
    }
  }, [])

  function updatePreference<K extends keyof NotificationPreferenceState>(
    key: K,
    value: NotificationPreferenceState[K]
  ): void {
    setPreferences((current) => ({ ...current, [key]: value }))
    setMessage(null)
  }

  async function savePreferences(): Promise<void> {
    setSaving(true)
    const result = await updateNotificationPreferences(preferences)
    setSaving(false)
    setMessage(
      result.success
        ? "Preferences saved."
        : result.error
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">General</h3>
        <div className="mt-3 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="timezone" className="text-xs">
              Timezone
            </Label>
            <Select
              value={preferences.timeZone}
              onValueChange={(value) => updatePreference("timeZone", value)}
            >
              <SelectTrigger id="timezone" className="h-9 w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">
                  Eastern (ET)
                </SelectItem>
                <SelectItem value="America/Chicago">
                  Central (CT)
                </SelectItem>
                <SelectItem value="America/Denver">
                  Mountain (MT)
                </SelectItem>
                <SelectItem value="America/Los_Angeles">
                  Pacific (PT)
                </SelectItem>
                <SelectItem value="Europe/London">
                  London (GMT)
                </SelectItem>
                <SelectItem value="Europe/Berlin">
                  Berlin (CET)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Weekly digest</Label>
              <p className="text-muted-foreground text-xs">
                Receive a summary of activity each week.
              </p>
            </div>
            <Switch
              checked={preferences.weeklyDigestEnabled}
              onCheckedChange={(checked) =>
                updatePreference("weeklyDigestEnabled", checked)
              }
              className="shrink-0"
            />
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-medium">Notifications</h3>
        <div className="mt-3 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Email notifications</Label>
              <p className="text-muted-foreground text-xs">
                Get notified about project updates via email.
              </p>
            </div>
            <Switch
              checked={preferences.emailEnabled}
              onCheckedChange={(checked) =>
                updatePreference("emailEnabled", checked)
              }
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Push notifications</Label>
              <p className="text-muted-foreground text-xs">
                {native
                  ? "Receive push notifications on your device."
                  : "Receive push notifications in your browser."}
              </p>
            </div>
            <Switch
              checked={preferences.pushEnabled}
              onCheckedChange={(checked) =>
                updatePreference("pushEnabled", checked)
              }
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">In-app notifications</Label>
              <p className="text-muted-foreground text-xs">
                Show actionable alerts in the Compass notification bell.
              </p>
            </div>
            <Switch
              checked={preferences.inAppEnabled}
              onCheckedChange={(checked) =>
                updatePreference("inAppEnabled", checked)
              }
              className="shrink-0"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">RFIs</Label>
              <Switch
                checked={preferences.rfiEnabled}
                onCheckedChange={(checked) =>
                  updatePreference("rfiEnabled", checked)
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Owner updates</Label>
              <Switch
                checked={preferences.ownerUpdateEnabled}
                onCheckedChange={(checked) =>
                  updatePreference("ownerUpdateEnabled", checked)
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Schedule</Label>
              <Switch
                checked={preferences.scheduleEnabled}
                onCheckedChange={(checked) =>
                  updatePreference("scheduleEnabled", checked)
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Purchase orders</Label>
              <Switch
                checked={preferences.poEnabled}
                onCheckedChange={(checked) =>
                  updatePreference("poEnabled", checked)
                }
              />
            </div>
          </div>

          {native && biometric.isAvailable && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">Biometric lock</Label>
                <p className="text-muted-foreground text-xs">
                  Require Face ID or fingerprint when returning
                  to the app.
                </p>
              </div>
              <Switch
                checked={biometric.isEnabled}
                onCheckedChange={biometric.setEnabled}
                className="shrink-0"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={savePreferences} disabled={saving}>
              {saving ? "Saving..." : "Save preferences"}
            </Button>
            {message && (
              <p className="text-xs text-muted-foreground">{message}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
