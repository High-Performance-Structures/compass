"use client"

// Code pieces Jarvis can render: CodeBlock (syntax highlighted) and DiffView.
// Part of the agent render registry; ../registry.tsx combines every group.

import { useState } from "react"
import { CodeBlock as ShikiCodeBlock, CodeBlockCopyButton } from "@/components/ai/code-block"
import type { ComponentMap } from "./types"

export const codeComponents: ComponentMap<
  | "CodeBlock"
  | "DiffView"
> = {
  // --- Code ---

  CodeBlock: ({ props }) => {
    const lang = props.language || "text"
    return (
      <div className="rounded-xl shadow-sm border overflow-hidden">
        {props.title && (
          <div className="bg-muted/50 px-4 py-1.5 text-xs font-medium border-b">
            {props.title}
          </div>
        )}
        <ShikiCodeBlock
          code={props.code}
          language={lang}
          showLineNumbers={props.showLineNumbers ?? false}
          className="rounded-none border-0 shadow-none"
        >
          <CodeBlockCopyButton />
        </ShikiCodeBlock>
      </div>
    )
  },

  DiffView: ({ props }) => {
    const [expanded, setExpanded] = useState<
      Record<number, boolean>
    >({})

    const toggle = (idx: number) =>
      setExpanded((prev) => ({
        ...prev,
        [idx]: !prev[idx],
      }))

    const statusBadge = (status: string) => {
      const colors: Record<string, string> = {
        added:
          "bg-success/10 text-success  ",
        modified:
          "bg-info/10 text-info  ",
        removed:
          "bg-destructive/10 text-destructive  ",
        renamed:
          "bg-warning/10 text-warning  ",
      }
      return (
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium uppercase ${colors[status] ?? "bg-muted text-foreground  "}`}
        >
          {status}
        </span>
      )
    }

    const renderPatch = (patch: string | null) => {
      if (!patch) {
        return (
          <div className="px-4 py-3 text-xs text-muted-foreground italic">
            (binary file or no changes)
          </div>
        )
      }
      const lines = patch.split("\n")
      return (
        <pre className="font-mono text-xs leading-5 overflow-x-auto">
          {lines.map((line, i) => {
            let cls = "px-4"
            if (line.startsWith("+")) {
              cls +=
                " bg-success/10 text-success  "
            } else if (line.startsWith("-")) {
              cls +=
                " bg-destructive/10 text-destructive  "
            } else if (line.startsWith("@@")) {
              cls +=
                " bg-info/10 text-info  "
            }
            return (
              <div key={i} className={cls}>
                {line}
              </div>
            )
          })}
        </pre>
      )
    }

    const files = props.files || []

    return (
      <div className="rounded-xl shadow-sm border overflow-hidden">
        {(props.title ||
          props.commitSha ||
          props.stats) && (
          <div className="px-4 py-3 border-b bg-muted/30 space-y-1">
            {props.title && (
              <div className="font-semibold text-sm">
                {props.title}
              </div>
            )}
            {(props.commitSha ||
              props.commitMessage) && (
              <div className="flex items-center gap-2 text-xs">
                {props.commitSha && (
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">
                    {props.commitSha}
                  </code>
                )}
                {props.commitMessage && (
                  <span className="text-muted-foreground truncate">
                    {props.commitMessage}
                  </span>
                )}
              </div>
            )}
            {props.stats && (
              <div className="flex gap-3 text-xs">
                <span className="text-success">
                  +{props.stats.additions}
                </span>
                <span className="text-destructive">
                  -{props.stats.deletions}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="divide-y">
          {files.map((file, idx) => {
            const isOpen = expanded[idx] ?? idx === 0
            return (
              <div key={idx}>
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full px-4 py-2 flex items-center gap-2 text-xs hover:bg-muted/40 transition-colors text-left"
                >
                  <span className="font-mono flex-1 truncate">
                    {file.filename}
                  </span>
                  {statusBadge(file.status)}
                  <span className="text-success">
                    +{file.additions}
                  </span>
                  <span className="text-destructive">
                    -{file.deletions}
                  </span>
                  <span className="text-muted-foreground">
                    {isOpen ? "\u25BC" : "\u25B6"}
                  </span>
                </button>
                {isOpen && renderPatch(file.patch)}
              </div>
            )
          })}
        </div>
      </div>
    )
  },
}
