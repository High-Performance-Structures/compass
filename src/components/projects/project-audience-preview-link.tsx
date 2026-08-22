"use client"

import * as React from "react"

import {
  projectAudiencePreviewHref,
  type ProjectAudiencePreviewRoute,
} from "@/lib/project-audience-preview-routes"
import {
  openProjectAudiencePreviewWindow,
  PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME,
} from "@/lib/project-audience-preview-window"

type ProjectAudiencePreviewLinkProps = Omit<
  React.ComponentPropsWithoutRef<"a">,
  "href" | "rel" | "target"
> & {
  readonly audience: ProjectAudiencePreviewRoute
  readonly projectId: string
}

export const ProjectAudiencePreviewLink = React.forwardRef<
  HTMLAnchorElement,
  ProjectAudiencePreviewLinkProps
>(function ProjectAudiencePreviewLink(
  { audience, projectId, onClick, ...props },
  ref
) {
  const href = projectAudiencePreviewHref(projectId, audience)

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    // Preserve native anchor navigation if the browser blocks popup creation.
    if (openProjectAudiencePreviewWindow(href)) event.preventDefault()
  }

  return (
    <a
      {...props}
      ref={ref}
      href={href}
      target={PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME}
      rel="opener"
      onClick={handleClick}
    />
  )
})

ProjectAudiencePreviewLink.displayName = "ProjectAudiencePreviewLink"
