"use client"

import dynamic from "next/dynamic"

// The response editor (TipTap/ProseMirror) only renders in the browser, so it
// loads there and stays out of the Worker's server bundle.
export const ProjectRfiResponseComposer = dynamic(
  () =>
    import("@/components/projects/project-rfi-response-composer").then(
      (module) => module.ProjectRfiResponseComposer
    ),
  { ssr: false, loading: () => <div className="min-h-40" aria-busy="true" /> }
)
