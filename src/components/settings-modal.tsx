"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
// import { useChatStateOptional } from "@/components/agent/chat-provider"
// import { ChatView } from "@/components/agent/chat-view"
import { NetSuiteConnectionStatus } from "@/components/netsuite/connection-status"
import { SyncControls } from "@/components/netsuite/sync-controls"
import { GoogleDriveConnectionStatus } from "@/components/google/connection-status"
import { SkillsTab } from "@/components/settings/skills-tab"
import { AIModelTab } from "@/components/settings/ai-model-tab"
import { AppearanceTab } from "@/components/settings/appearance-tab"
import { ClaudeCodeTab } from "@/components/settings/claude-code-tab"
import { useNative } from "@/hooks/use-native"
import { useBiometricAuth } from "@/hooks/use-biometric-auth"

const SETTINGS_TABS = [
  { value: "general", label: "General" },
  { value: "notifications", label: "Notifications" },
  { value: "appearance", label: "Theme" },
  { value: "integrations", label: "Integrations" },
  { value: "ai-model", label: "AI Model" },
  { value: "agent", label: "Agent" },
  { value: "skills", label: "Skills" },
] as const

const CREATE_SETTING_TAB = {
  value: "create-setting",
  label: "Create Setting",
} as const

interface CustomSettingTab {
  readonly value: string
  readonly label: string
  readonly prompt: string
}

function makeCustomSettingValue(
  label: string,
  existingTabs: ReadonlyArray<CustomSettingTab>
): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
  const base = normalized.length > 0 ? normalized : "setting"

  let candidate = `custom-${base}`
  let suffix = 2
  while (existingTabs.some((tab) => tab.value === candidate)) {
    candidate = `custom-${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [emailNotifs, setEmailNotifs] = React.useState(true)
  const [pushNotifs, setPushNotifs] = React.useState(true)
  const [weeklyDigest, setWeeklyDigest] = React.useState(false)
  const [timezone, setTimezone] = React.useState("America/New_York")
  const [signetId, setSignetId] = React.useState("")
  const [customTabs, setCustomTabs] = React.useState<ReadonlyArray<CustomSettingTab>>([])
  const [activeTab, setActiveTab] = React.useState<string>("general")
  const [newSettingName, setNewSettingName] = React.useState("")
  const [newSettingPrompt, setNewSettingPrompt] = React.useState("")
  // const [isMobileChatOpen, setIsMobileChatOpen] = React.useState(false)
  // const chatState = useChatStateOptional()

  const menuTabs = React.useMemo(
    () => [...SETTINGS_TABS, ...customTabs],
    [customTabs]
  )

  const sendCreateSettingToChat = React.useCallback(() => {
    toast.info("AI chat is currently disabled in settings")
  }, [])

  const openCreateSettingFlow = React.useCallback(() => {
    setActiveTab(CREATE_SETTING_TAB.value)
    // setIsMobileChatOpen(true)
    // chatState?.sendMessage({ text: "Create a new setting" })
  }, [])

  const handleSectionSelect = React.useCallback((value: string) => {
    if (value === CREATE_SETTING_TAB.value) {
      openCreateSettingFlow()
      return
    }
    setActiveTab(value)
  }, [openCreateSettingFlow])

  const createCustomSetting = React.useCallback(() => {
    const label = newSettingName.trim()
    const details = newSettingPrompt.trim()

    if (!label) {
      toast.error("Add a setting name first")
      return
    }
    if (!details) {
      toast.error("Describe what the setting should do")
      return
    }

    const nextTab: CustomSettingTab = {
      value: makeCustomSettingValue(label, customTabs),
      label,
      prompt: details,
    }
    setCustomTabs((prev) => [...prev, nextTab])
    setActiveTab(nextTab.value)
    // setIsMobileChatOpen(true)
    setNewSettingName("")
    setNewSettingPrompt("")
    sendCreateSettingToChat()
    toast.success(`Added ${nextTab.label} to settings`)
  }, [customTabs, newSettingName, newSettingPrompt, sendCreateSettingToChat])

  const native = useNative()
  const biometric = useBiometricAuth()

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="timezone" className="text-xs">
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                  <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                  <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                  <SelectItem value="Europe/London">London (GMT)</SelectItem>
                  <SelectItem value="Europe/Berlin">Berlin (CET)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

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
        )

      case "notifications":
        return (
          <div className="space-y-4 pt-2">
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

            <Separator />

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
              <>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-xs">Biometric lock</Label>
                    <p className="text-muted-foreground text-xs">
                      Require Face ID or fingerprint when returning to the app.
                    </p>
                  </div>
                  <Switch
                    checked={biometric.isEnabled}
                    onCheckedChange={biometric.setEnabled}
                    className="shrink-0"
                  />
                </div>
              </>
            )}
          </div>
        )

      case "appearance":
        return <div className="pt-2"><AppearanceTab /></div>

      case "integrations":
        return (
          <div className="space-y-4 pt-2">
            <GoogleDriveConnectionStatus />
            <Separator />
            <NetSuiteConnectionStatus />
            <SyncControls />
            <Separator />
            <ClaudeCodeTab />
          </div>
        )

      case "ai-model":
        return <div className="pt-2"><AIModelTab /></div>

      case "agent":
        return (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="signet-id" className="text-xs">
                Signet ID (ETH)
              </Label>
              <Input
                id="signet-id"
                value={signetId}
                onChange={(e) => setSignetId(e.target.value)}
                placeholder="0x..."
                className="h-9 font-mono"
                type="password"
              />
            </div>

            <Separator />

            <Button className="w-full">
              Configure your agent
            </Button>
          </div>
        )

      case "skills":
        return <div className="pt-2"><SkillsTab /></div>

      case CREATE_SETTING_TAB.value:
        return (
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-sm font-medium">Create a new setting</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Describe the setting you want, then send it to AI chat.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-setting-name" className="text-xs">
                Setting name
              </Label>
              <Input
                id="new-setting-name"
                value={newSettingName}
                onChange={(e) => setNewSettingName(e.target.value)}
                placeholder="Example: Project defaults"
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-setting-prompt" className="text-xs">
                What should this setting do?
              </Label>
              <Textarea
                id="new-setting-prompt"
                value={newSettingPrompt}
                onChange={(e) => setNewSettingPrompt(e.target.value)}
                placeholder="Describe the controls and behavior you want"
                rows={4}
                className="resize-none"
              />
            </div>

            <Button onClick={createCustomSetting} className="w-full">
              <IconPlus className="size-4" />
              Create Setting with AI
            </Button>
          </div>
        )

      default:
        const customTab = customTabs.find((tab) => tab.value === activeTab)
        if (customTab) {
          return (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">{customTab.label}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {customTab.prompt}
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => sendCreateSettingToChat()}
              >
                Send to AI Chat
              </Button>
            </div>
          )
        }
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[85vh] max-h-[700px] w-full max-w-[600px] overflow-hidden p-0 md:h-auto md:max-h-[85vh] md:max-w-[700px]">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your app preferences.</DialogDescription>
        </DialogHeader>
        
        <div className="flex h-[calc(85vh-80px)] flex-col overflow-hidden md:h-[500px]">
          {/* Desktop: 2 columns | Mobile: Single column */}
          <div className="flex flex-1 flex-col gap-6 overflow-hidden p-6 md:grid md:grid-cols-[180px_1fr]">
            
            {/* Left Column - Navigation (Desktop only) */}
            <aside className="hidden md:flex md:flex-col md:overflow-hidden">
              <div className="flex h-full flex-col justify-between rounded-xl border bg-muted/20 p-2">
                <div className="flex flex-col gap-1 overflow-y-auto">
                  {menuTabs.map((tab) => (
                    <Button
                      key={tab.value}
                      type="button"
                      variant={tab.value === activeTab ? "secondary" : "ghost"}
                      className="h-8 w-full justify-start text-sm"
                      onClick={() => setActiveTab(tab.value)}
                    >
                      {tab.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-4 shrink-0">
                  <Separator className="mb-4" />
                  <Button
                    type="button"
                    variant={activeTab === CREATE_SETTING_TAB.value ? "secondary" : "outline"}
                    className="h-8 w-full justify-start gap-1.5 text-sm"
                    onClick={openCreateSettingFlow}
                  >
                    <IconPlus className="size-4" />
                    {CREATE_SETTING_TAB.label}
                  </Button>
                </div>
              </div>
            </aside>

            {/* Middle Column - Content */}
            <div className="flex min-h-0 flex-col overflow-hidden">
              {/* Mobile Navigation */}
              <div className="mb-4 md:hidden">
                <Select value={activeTab} onValueChange={handleSectionSelect}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Select section" />
                  </SelectTrigger>
                  <SelectContent>
                    {menuTabs.map((tab) => (
                      <SelectItem key={tab.value} value={tab.value}>
                        {tab.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={CREATE_SETTING_TAB.value}>
                      {CREATE_SETTING_TAB.label}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Settings Content - Scrollable */}
              <div className="flex-1 overflow-y-auto pr-2">
                {renderContent()}
              </div>
            </div>

            {/* Right Column - AI Chat (Desktop only) - COMMENTED OUT */}
            {/*
            <div className="hidden overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur-sm md:block">
              <ChatView
                variant="panel"
                hideSuggestions
                inputPlaceholder="Create a new setting"
              />
            </div>
            */}
          </div>
        </div>

        {/* Mobile Chat Overlay - COMMENTED OUT */}
        {/*
        <div
          className={`fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-300 ease-out md:hidden ${
            isMobileChatOpen ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mx-4 mb-4 overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">AI Assistant</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMobileChatOpen(false)}
              >
                Close
              </Button>
            </div>
            <div className="h-[50vh]">
              <ChatView
                variant="panel"
                hideSuggestions
                inputPlaceholder="Create a new setting"
              />
            </div>
          </div>
        </div>

        {isMobileChatOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setIsMobileChatOpen(false)}
          />
        )}
        */}
      </DialogContent>
    </Dialog>
  )
}
