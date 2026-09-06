"use client"

import * as React from "react"

import type {
  HelpGuidePreview,
  HelpTopicPreview,
} from "@/components/help/help-ui-model"

type HelpUiContextValue = Readonly<{
  guides: readonly HelpGuidePreview[]
  topics: ReadonlyMap<string, HelpTopicPreview>
  canViewHelp: boolean
  canUseJarvis: boolean
}>

const HelpUiContext = React.createContext<HelpUiContextValue>({
  guides: [],
  topics: new Map(),
  canViewHelp: false,
  canUseJarvis: false,
})

function topicMap(guides: readonly HelpGuidePreview[]): ReadonlyMap<string, HelpTopicPreview> {
  const topics = new Map<string, HelpTopicPreview>()
  for (const guide of guides) {
    topics.set(guide.id, {
      topicId: guide.id,
      title: guide.title,
      summary: guide.contextSummary,
      href: `/dashboard/help/${guide.slug}`,
    })
    for (const section of guide.sections) {
      topics.set(section.topicId, {
        topicId: section.topicId,
        title: section.title,
        summary: section.summary,
        href: `/dashboard/help/${guide.slug}#${section.id}`,
      })
    }
  }
  return topics
}

export function HelpUiProvider({
  guides,
  canUseJarvis = false,
  children,
}: {
  readonly guides: readonly HelpGuidePreview[]
  readonly canUseJarvis?: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const value = React.useMemo(
    () => ({
      guides,
      topics: topicMap(guides),
      canViewHelp: guides.length > 0,
      canUseJarvis,
    }),
    [canUseJarvis, guides],
  )

  return <HelpUiContext.Provider value={value}>{children}</HelpUiContext.Provider>
}

export function useAllowedHelpGuides(): readonly HelpGuidePreview[] {
  return React.useContext(HelpUiContext).guides
}

export function useCanViewHelp(): boolean {
  return React.useContext(HelpUiContext).canViewHelp
}

export function useCanUseHelpJarvis(): boolean {
  return React.useContext(HelpUiContext).canUseJarvis
}

export function useAuthorizedHelpTopic(topicId: string): HelpTopicPreview | null {
  return React.useContext(HelpUiContext).topics.get(topicId) ?? null
}
