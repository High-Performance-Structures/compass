"use client"

import * as React from "react"

import {
  getNotificationPreferences,
  sendTestSmsNotification,
  updateNotificationPreferences,
  type NotificationPreferenceState,
} from "@/app/actions/notifications"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import {
  SMS_OPT_IN_CONSENT_LABEL,
  SMS_OPT_IN_DISCLOSURE_URL,
  SMS_OPT_IN_DISCLOSURE_VERSION,
} from "@/lib/notifications/sms-consent"

export function PreferencesTab() {
  const [preferences, setPreferences] =
    React.useState<NotificationPreferenceState>({
      timeZone: "America/Denver",
      inAppEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      smsPhoneNumber: null,
      smsConsentAccepted: false,
      smsConsentAcceptedAt: null,
      smsConsentDisclosureUrl: null,
      smsConsentDisclosureVersion: null,
      smsConsentPhoneNumber: null,
      pushEnabled: true,
      mentionEmailEnabled: true,
      mentionSmsEnabled: false,
      announcementEmailEnabled: true,
      announcementSmsEnabled: false,
      weeklyDigestEnabled: false,
      rfiEnabled: true,
      ownerUpdateEnabled: true,
      scheduleEnabled: true,
      poEnabled: true,
    })
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [message, setMessage] = React.useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false)
  const [disclosureOpen, setDisclosureOpen] = React.useState(false)
  const [testingSms, setTestingSms] = React.useState(false)
  const native = useNative()
  const biometric = useBiometricAuth()
  const smsPhoneNumber = preferences.smsPhoneNumber?.trim() ?? ""
  const smsConsentMatchesPhone =
    preferences.smsConsentPhoneNumber === smsPhoneNumber
  const smsConsentMatchesVersion =
    preferences.smsConsentDisclosureVersion === SMS_OPT_IN_DISCLOSURE_VERSION
  const smsConsentIsCurrent =
    preferences.smsConsentAccepted &&
    smsConsentMatchesPhone &&
    smsConsentMatchesVersion
  const smsConsentReady =
    !preferences.smsEnabled ||
    (smsPhoneNumber.length > 0 && preferences.smsConsentAccepted)

  React.useEffect(() => {
    let cancelled = false
    async function loadPreferences(): Promise<void> {
      const result = await getNotificationPreferences()
      if (!cancelled) {
        if (result.success) {
          setPreferences(result.data)
          setHasUnsavedChanges(false)
        } else {
          setMessage(result.error)
        }
        setLoading(false)
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
    setHasUnsavedChanges(true)
    setMessage("Unsaved changes.")
  }

  function updateSmsEnabled(checked: boolean): void {
    setPreferences((current) => ({
      ...current,
      smsEnabled: checked,
      mentionSmsEnabled: checked ? current.mentionSmsEnabled : false,
      announcementSmsEnabled: checked
        ? current.announcementSmsEnabled
        : false,
    }))
    setHasUnsavedChanges(true)
    setMessage("Unsaved changes.")
  }

  function updateSmsPhoneNumber(value: string): void {
    const nextPhoneNumber = value.trim().length > 0 ? value : null
    setPreferences((current) => {
      const normalizedPhoneNumber = nextPhoneNumber?.trim() ?? ""
      const consentStillApplies =
        current.smsConsentAccepted &&
        current.smsConsentPhoneNumber === normalizedPhoneNumber &&
        current.smsConsentDisclosureVersion === SMS_OPT_IN_DISCLOSURE_VERSION
      return {
        ...current,
        smsPhoneNumber: nextPhoneNumber,
        smsConsentAccepted: consentStillApplies,
        smsConsentAcceptedAt: consentStillApplies
          ? current.smsConsentAcceptedAt
          : null,
        smsConsentDisclosureUrl: consentStillApplies
          ? current.smsConsentDisclosureUrl
          : null,
        smsConsentDisclosureVersion: consentStillApplies
          ? current.smsConsentDisclosureVersion
          : null,
        smsConsentPhoneNumber: consentStillApplies
          ? current.smsConsentPhoneNumber
          : null,
      }
    })
    setHasUnsavedChanges(true)
    setMessage("Unsaved changes.")
  }

  function updateSmsConsentAccepted(checked: boolean): void {
    setPreferences((current) => ({
      ...current,
      smsConsentAccepted: checked,
      smsConsentAcceptedAt: checked ? current.smsConsentAcceptedAt : null,
      smsConsentDisclosureUrl: checked ? SMS_OPT_IN_DISCLOSURE_URL : null,
      smsConsentDisclosureVersion: checked
        ? SMS_OPT_IN_DISCLOSURE_VERSION
        : null,
      smsConsentPhoneNumber: checked
        ? current.smsPhoneNumber?.trim() ?? null
        : null,
    }))
    setHasUnsavedChanges(true)
    setMessage("Unsaved changes.")
  }

  async function savePreferences(): Promise<void> {
    if (!smsConsentReady) {
      setMessage(
        "Add a text phone number and accept the SMS opt-in disclosure first."
      )
      return
    }
    setSaving(true)
    const result = await updateNotificationPreferences(preferences)
    setSaving(false)
    if (result.success) {
      setHasUnsavedChanges(false)
    }
    setMessage(
      result.success
        ? "Preferences saved."
        : result.error
    )
  }

  async function sendTestText(): Promise<void> {
    if (hasUnsavedChanges) {
      setMessage("Save notification preferences before sending a test text.")
      return
    }

    setTestingSms(true)
    const result = await sendTestSmsNotification()
    setTestingSms(false)
    setMessage(
      result.success
        ? "Test text sent."
        : `Test text failed: ${result.error}`
    )
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading notification preferences...
      </p>
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
              onValueChange={(value) =>
                updatePreference("timeZone", value)
              }
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

          <div className="space-y-3 border-y py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">Text notifications</Label>
                <p className="text-muted-foreground text-xs">
                  Direct mentions and announcements by text.
                </p>
              </div>
              <Switch
                checked={preferences.smsEnabled}
                onCheckedChange={updateSmsEnabled}
                className="shrink-0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smsPhoneNumber" className="text-xs">
                Text phone number
              </Label>
              <Input
                id="smsPhoneNumber"
                value={preferences.smsPhoneNumber ?? ""}
                onChange={(event) =>
                  updateSmsPhoneNumber(event.currentTarget.value)
                }
                placeholder="(719) 555-0123"
                disabled={!preferences.smsEnabled}
                className="h-9 max-w-xs"
              />
            </div>
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="smsConsentAccepted"
                  checked={preferences.smsConsentAccepted}
                  disabled={!preferences.smsEnabled || smsPhoneNumber.length === 0}
                  onCheckedChange={(checked) =>
                    updateSmsConsentAccepted(checked === true)
                  }
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="smsConsentAccepted"
                    className="text-xs leading-5"
                  >
                    {SMS_OPT_IN_CONSENT_LABEL}
                  </Label>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => setDisclosureOpen(true)}
                    >
                      View SMS Opt-In Disclosure
                    </button>
                    <span aria-hidden="true">·</span>
                    <a
                      href={SMS_OPT_IN_DISCLOSURE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Open public page
                    </a>
                  </div>
                </div>
              </div>
              {preferences.smsEnabled && smsPhoneNumber.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {smsConsentIsCurrent
                    ? `Opt-in recorded for ${preferences.smsConsentPhoneNumber}.`
                    : "Accept the disclosure to turn on text notifications for this number."}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={sendTestText}
                disabled={
                  testingSms ||
                  hasUnsavedChanges ||
                  !preferences.smsEnabled ||
                  !smsConsentIsCurrent
                }
              >
                {testingSms ? "Sending test..." : "Send test text"}
              </Button>
              {hasUnsavedChanges && preferences.smsEnabled && (
                <p className="text-xs text-muted-foreground">
                  Save changes before sending a test text.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-y py-3 sm:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label className="text-xs">When I am mentioned</Label>
                <p className="text-muted-foreground text-xs">
                  Applies to @mentions, @channel, and @here.
                </p>
                <p className="text-muted-foreground text-xs">
                  Compass does not send alerts for messages you send yourself.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Email</span>
                <Switch
                  checked={preferences.mentionEmailEnabled}
                  onCheckedChange={(checked) =>
                    updatePreference("mentionEmailEnabled", checked)
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Text</span>
                <Switch
                  checked={preferences.mentionSmsEnabled}
                  disabled={!preferences.smsEnabled || !smsConsentReady}
                  onCheckedChange={(checked) =>
                    updatePreference("mentionSmsEnabled", checked)
                  }
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Announcements</Label>
                <p className="text-muted-foreground text-xs">
                  Staff, owner, client, or sub/vendor announcements.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Email</span>
                <Switch
                  checked={preferences.announcementEmailEnabled}
                  onCheckedChange={(checked) =>
                    updatePreference("announcementEmailEnabled", checked)
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Text</span>
                <Switch
                  checked={preferences.announcementSmsEnabled}
                  disabled={!preferences.smsEnabled || !smsConsentReady}
                  onCheckedChange={(checked) =>
                    updatePreference("announcementSmsEnabled", checked)
                  }
                />
              </div>
            </div>
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
            <Button
              size="sm"
              onClick={savePreferences}
              disabled={saving || !smsConsentReady}
              variant={hasUnsavedChanges ? "default" : "outline"}
            >
              {saving ? "Saving..." : "Save preferences"}
            </Button>
            {message && (
              <p className="text-xs text-muted-foreground">{message}</p>
            )}
          </div>
        </div>
      </div>
      <Dialog open={disclosureOpen} onOpenChange={setDisclosureOpen}>
        <DialogContent className="max-h-[min(90vh,680px)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>SMS Opt-In Disclosure</DialogTitle>
            <DialogDescription>
              This is the disclosure Compass records when SMS
              notifications are enabled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-6">
            <p>{SMS_OPT_IN_CONSENT_LABEL}</p>
            <p className="text-muted-foreground">
              Disclosure version {SMS_OPT_IN_DISCLOSURE_VERSION}. The
              public disclosure page is hosted by High Performance
              Structures and can be used for GoTo/TCR review.
            </p>
            <a
              href={SMS_OPT_IN_DISCLOSURE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Open full SMS Opt-In Disclosure
            </a>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  )
}
