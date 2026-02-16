"use client"

import * as React from "react"
import {
  IconAdjustments,
  IconBrain,
  IconPalette,
  IconPlug,
  IconPuzzle,
  IconRobot,
  IconTerminal2,
  IconUsers,
} from "@tabler/icons-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { PreferencesTab } from "@/components/settings/preferences-tab"
import { AppearanceTab } from "@/components/settings/appearance-tab"
import { TeamTab } from "@/components/settings/team-tab"
import { AIModelTab } from "@/components/settings/ai-model-tab"
import { SkillsTab } from "@/components/settings/skills-tab"
import { ClaudeCodeTab } from "@/components/settings/claude-code-tab"
import { NetSuiteConnectionStatus } from "@/components/netsuite/connection-status"
import { SyncControls } from "@/components/netsuite/sync-controls"
import { GoogleDriveConnectionStatus } from "@/components/google/connection-status"

const SETTINGS_TABS = [
  { value: "preferences", label: "Preferences", icon: IconAdjustments },
  { value: "appearance", label: "Theme", icon: IconPalette },
  { value: "team", label: "Team", icon: IconUsers },
  { value: "ai-model", label: "AI Model", icon: IconBrain },
  { value: "agent", label: "Agent", icon: IconRobot },
  { value: "skills", label: "Skills", icon: IconPuzzle },
  { value: "integrations", label: "Integrations", icon: IconPlug },
  { value: "claude-code", label: "Code Bridge", icon: IconTerminal2 },
] as const

type SectionValue = (typeof SETTINGS_TABS)[number]["value"]

// wide sections get unconstrained width for tables/complex layouts
const WIDE_SECTIONS = new Set<string>([
  "appearance", "team", "ai-model", "claude-code",
])

function AgentSection() {
  const [signetId, setSignetId] = React.useState("")

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signet-id" className="text-xs">
          Signet ID (ETH)
        </Label>
        <Input
          id="signet-id"
          value={signetId}
          onChange={(e) => setSignetId(e.target.value)}
          placeholder="0x..."
          className="h-9 max-w-sm font-mono"
          type="password"
        />
      </div>
      <Separator />
      <Button className="w-full max-w-sm">
        Configure your agent
      </Button>
    </div>
  )
}

function IntegrationsSection() {
  return (
    <div className="space-y-4">
      <GoogleDriveConnectionStatus />
      <Separator />
      <NetSuiteConnectionStatus />
      <SyncControls />
    </div>
  )
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] =
    React.useState<SectionValue>("preferences")
  const isMobile = useIsMobile()

  const isWide = WIDE_SECTIONS.has(activeSection)

  const renderContent = (): React.ReactNode => {
    switch (activeSection) {
      case "preferences":
        return <PreferencesTab />
      case "appearance":
        return <AppearanceTab />
      case "team":
        return <TeamTab />
      case "ai-model":
        return <AIModelTab />
      case "agent":
        return <AgentSection />
      case "skills":
        return <SkillsTab />
      case "integrations":
        return <IntegrationsSection />
      case "claude-code":
        return <ClaudeCodeTab />
      default:
        return null
    }
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* tab bar — pinned to top, full bleed */}
      <div className="shrink-0 border-b bg-background/80 backdrop-blur-sm">
        <div className="px-4 sm:px-6 md:px-8">
          {isMobile ? (
            <div className="py-3">
              <Select
                value={activeSection}
                onValueChange={(v) =>
                  setActiveSection(v as SectionValue)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SETTINGS_TABS.map((tab) => (
                    <SelectItem key={tab.value} value={tab.value}>
                      {tab.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <nav className="flex items-end gap-0.5 -mb-px">
              {SETTINGS_TABS.map((tab) => {
                const isActive = activeSection === tab.value
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveSection(tab.value)}
                    className={cn(
                      "relative flex items-center gap-1.5",
                      "whitespace-nowrap px-3 py-2.5 text-sm",
                      "transition-colors duration-100",
                      isActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <tab.icon className="size-4 shrink-0" stroke={1.5} />
                    {tab.label}
                    {isActive && (
                      <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
                    )}
                  </button>
                )
              })}
            </nav>
          )}
        </div>
      </div>

      {/* scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div
          className={cn(
            "px-4 sm:px-6 md:px-8 py-6",
            !isWide && "max-w-[640px]"
          )}
        >
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
