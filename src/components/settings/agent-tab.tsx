"use client"

import * as React from "react"
import {
  BrainCircuit,
  Blocks,
  Cable,
  Fingerprint,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { AIModelTab } from "@/components/settings/ai-model-tab"
import { SkillsTab } from "@/components/settings/skills-tab"
import { ClaudeCodeTab } from "@/components/settings/claude-code-tab"
import { cn } from "@/lib/utils"

const SUB_TABS = [
  { value: "model", label: "Model", icon: BrainCircuit },
  { value: "skills", label: "Skills", icon: Blocks },
  { value: "bridge", label: "Bridge", icon: Cable },
  { value: "identity", label: "Identity", icon: Fingerprint },
] as const

type SubTab = (typeof SUB_TABS)[number]["value"]

export function AgentTab(): React.ReactElement {
  const [activeSubTab, setActiveSubTab] =
    React.useState<SubTab>("model")
  const [signetId, setSignetId] = React.useState("")

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        className="flex gap-1.5"
        role="radiogroup"
        aria-label="Agent settings"
      >
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.value
          const Icon = tab.icon
          return (
            <button
              key={tab.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setActiveSubTab(tab.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5",
                "text-xs font-medium transition-all",
                isActive
                  ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                  : "text-muted-foreground hover:bg-muted/70"
              )}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeSubTab === "model" && <AIModelTab />}
        {activeSubTab === "skills" && <SkillsTab />}
        {activeSubTab === "bridge" && <ClaudeCodeTab />}
        {activeSubTab === "identity" && (
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
                className="h-9 font-mono"
                type="password"
              />
            </div>

            <Separator />

            <Button className="w-full">
              Configure your agent
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
