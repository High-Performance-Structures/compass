"use client"

import * as React from "react"
import Mention from "@tiptap/extension-mention"
import Placeholder from "@tiptap/extension-placeholder"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react"
import { IconAt, IconCircleCheck, IconLoader2 } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { updateProjectRfi } from "@/app/actions/project-rfis"
import { createMentionSuggestion } from "@/components/conversations/mention-suggestion"
import { Button } from "@/components/ui/button"

function mentionedUserIds(document: JSONContent): readonly string[] {
  const ids = new Set<string>()

  function walk(node: JSONContent): void {
    if (node.type === "mention") {
      const id = node.attrs?.id
      if (
        typeof id === "string" &&
        id !== "channel" &&
        id !== "here" &&
        id !== "compass-agent"
      ) {
        ids.add(id)
      }
    }
    for (const child of node.content ?? []) walk(child)
  }

  walk(document)
  return Array.from(ids)
}

export function ProjectRfiResponseComposer({
  projectId,
  rfiId,
  status,
  audience,
}: {
  readonly projectId: string
  readonly rfiId: string
  readonly status: string
  readonly audience: string
}): React.ReactElement {
  const router = useRouter()
  const [selectedStatus, setSelectedStatus] = React.useState(status)
  const [selectedAudience, setSelectedAudience] = React.useState(audience)
  const [saving, setSaving] = React.useState(false)
  const [hasResponse, setHasResponse] = React.useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: "Add a response, decision, follow-up question, or next step",
      }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: createMentionSuggestion(projectId, { peopleOnly: true }),
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`
        },
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      setHasResponse(updatedEditor.getText().trim().length > 0)
    },
  })

  async function save(): Promise<void> {
    if (!editor || saving) return
    const response = editor.getText().trim()
    setSaving(true)
    try {
      const mentions = mentionedUserIds(editor.getJSON())
      const result = await updateProjectRfi(projectId, rfiId, {
        answer: response || null,
        status: selectedStatus,
        audience: selectedAudience,
        mentionedUserIds: mentions,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      editor.commands.clearContent()
      setHasResponse(false)
      toast.success(
        response
          ? mentions.length > 0
            ? "Response saved to this RFI. Mentioned users were notified."
            : "Response saved to this RFI."
          : "RFI settings updated."
      )
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error &&
          error.message.includes("Server Action") &&
          error.message.includes("was not found")
          ? "Compass was updated while this page was open. Refresh and try again; your response is still here."
          : error instanceof Error
            ? error.message
            : "Unable to save this RFI response."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <EditorContent editor={editor} />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconAt className="size-3.5" />
        Type @ and a name to notify a Compass user. Every response remains attached to this RFI.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <select
          aria-label="RFI status"
          value={selectedStatus}
          onChange={(event) => setSelectedStatus(event.currentTarget.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="new">New</option>
          <option value="in_progress">In progress</option>
          <option value="info_needed">Additional information needed</option>
          <option value="complete">Complete</option>
          <option value="void">Void</option>
        </select>
        <select
          aria-label="RFI audience"
          value={selectedAudience}
          onChange={(event) => setSelectedAudience(event.currentTarget.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="internal">Internal only</option>
          <option value="sub_vendor">Sub/vendor visible</option>
          <option value="owner">Owner visible</option>
          <option value="public">Owner and sub/vendor visible</option>
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={saving || (!hasResponse && selectedStatus === status && selectedAudience === audience)}
          onClick={() => void save()}
        >
          {saving ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconCircleCheck className="size-4" />
          )}
          Save
        </Button>
      </div>
    </div>
  )
}
