"use client"

import * as React from "react"
import { useTheme } from "next-themes"

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { NetSuiteConnectionStatus } from "@/components/netsuite/connection-status"
import { SyncControls } from "@/components/netsuite/sync-controls"
import { MemoriesTable } from "@/components/agent/memories-table"
import { SkillsTab } from "@/components/settings/skills-tab"

export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { theme, setTheme } = useTheme()
  const [emailNotifs, setEmailNotifs] = React.useState(true)
  const [pushNotifs, setPushNotifs] = React.useState(true)
  const [weeklyDigest, setWeeklyDigest] = React.useState(false)
  const [timezone, setTimezone] = React.useState("America/New_York")

  const generalPage = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="timezone" className="text-xs">
          Timezone
        </Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="timezone" className="w-full h-9">
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

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
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
    </>
  )

  const notificationsPage = (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
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

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Label className="text-xs">Push notifications</Label>
          <p className="text-muted-foreground text-xs">
            Receive push notifications in your browser.
          </p>
        </div>
        <Switch
          checked={pushNotifs}
          onCheckedChange={setPushNotifs}
          className="shrink-0"
        />
      </div>
    </>
  )

  const appearancePage = (
    <div className="space-y-1.5">
      <Label htmlFor="theme" className="text-xs">
        Theme
      </Label>
      <Select
        value={theme ?? "light"}
        onValueChange={setTheme}
      >
        <SelectTrigger id="theme" className="w-full h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )

  const integrationsPage = (
    <>
      <NetSuiteConnectionStatus />
      <SyncControls />
    </>
  )

  const slabMemoryPage = <MemoriesTable />

  const skillsPage = <SkillsTab />

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Manage your app preferences."
      className="sm:max-w-xl"
    >
      <ResponsiveDialogBody
        pages={[generalPage, notificationsPage, appearancePage, integrationsPage, slabMemoryPage, skillsPage]}
      >
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="w-full inline-flex justify-start overflow-x-auto">
            <TabsTrigger value="general" className="text-xs sm:text-sm shrink-0">
              General
            </TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs sm:text-sm shrink-0">
              Notifications
            </TabsTrigger>
            <TabsTrigger value="appearance" className="text-xs sm:text-sm shrink-0">
              Appearance
            </TabsTrigger>
            <TabsTrigger value="integrations" className="text-xs sm:text-sm shrink-0">
              Integrations
            </TabsTrigger>
            <TabsTrigger value="slab-memory" className="text-xs sm:text-sm shrink-0">
              Slab Memory
            </TabsTrigger>
            <TabsTrigger value="skills" className="text-xs sm:text-sm shrink-0">
              Skills
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="timezone" className="text-xs">
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="w-full h-9">
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

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
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
          </TabsContent>

          <TabsContent
            value="notifications"
            className="space-y-3 pt-3"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
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

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-xs">Push notifications</Label>
                <p className="text-muted-foreground text-xs">
                  Receive push notifications in your browser.
                </p>
              </div>
              <Switch
                checked={pushNotifs}
                onCheckedChange={setPushNotifs}
                className="shrink-0"
              />
            </div>
          </TabsContent>

          <TabsContent
            value="appearance"
            className="space-y-3 pt-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="theme" className="text-xs">
                Theme
              </Label>
              <Select
                value={theme ?? "light"}
                onValueChange={setTheme}
              >
                <SelectTrigger id="theme" className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent
            value="integrations"
            className="space-y-3 pt-3"
          >
            <NetSuiteConnectionStatus />
            <SyncControls />
          </TabsContent>

          <TabsContent
            value="slab-memory"
            className="space-y-3 pt-3"
          >
            <MemoriesTable />
          </TabsContent>

          <TabsContent
            value="skills"
            className="space-y-3 pt-3"
          >
            <SkillsTab />
          </TabsContent>
        </Tabs>
      </ResponsiveDialogBody>
    </ResponsiveDialog>
  )
}
