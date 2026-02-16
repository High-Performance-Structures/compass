"use client"

import * as React from "react"

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
  const [emailNotifs, setEmailNotifs] = React.useState(true)
  const [pushNotifs, setPushNotifs] = React.useState(true)
  const [weeklyDigest, setWeeklyDigest] = React.useState(false)
  const [timezone, setTimezone] = React.useState("America/New_York")
  const native = useNative()
  const biometric = useBiometricAuth()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">General</h3>
        <div className="mt-3 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="timezone" className="text-xs">
              Timezone
            </Label>
            <Select value={timezone} onValueChange={setTimezone}>
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
              checked={weeklyDigest}
              onCheckedChange={setWeeklyDigest}
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
              checked={emailNotifs}
              onCheckedChange={setEmailNotifs}
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
              checked={pushNotifs}
              onCheckedChange={setPushNotifs}
              className="shrink-0"
            />
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
        </div>
      </div>
    </div>
  )
}
