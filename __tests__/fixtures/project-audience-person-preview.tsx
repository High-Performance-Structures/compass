import Link from "next/link"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { ProjectAudiencePersonSelector } from "@/components/projects/project-audience-person-selector"
import { ProjectAudiencePreviewScope } from "@/components/projects/project-audience-preview-scope"
import { ProjectAudienceCorrespondencePreview } from "@/components/projects/project-audience-correspondence-preview"
import type { CorrespondenceInbox } from "@/lib/correspondence/types"

const person = new URLSearchParams(window.location.search).get("previewAs") ?? "owner-a"
const inbox: CorrespondenceInbox = {
  viewerId: person, workspace: "owner", projectName: "Example project", compositionDraft: null, contacts: [],
  conversations: [{ id: `conversation-${person}`, projectId: "project-a", subject: `${person} project email`, excerpt: "Visible only with the selected person's message grant", people: [], lastActivityAt: "2026-10-24T12:00:00Z", unread: true, saved: false, followUp: false, archived: false, closed: false, shareReadReceipts: false }],
}
const root = document.getElementById("root")
if (root) createRoot(root).render(<main className="mx-auto grid max-w-5xl gap-4 p-4">
  <h1 className="text-xl font-semibold">Owner preview · Read only</h1>
  <ProjectAudiencePersonSelector projectId="project-a" audience="owner" selectedUserId={person} options={[{ id: "owner-a", name: "Owner A", email: "a@example.test", companyName: "Example client" }, { id: "owner-b", name: "Owner B", email: "b@example.test", companyName: "Second client" }]} />
  <ProjectAudiencePreviewScope readOnly canonicalScope={{ projectId: "project-a", audience: "owner", targetUserId: person }}>
    <Link href="/preview/projects/project-a/owner/schedule" className="text-sm underline">Schedule</Link>
    <ProjectAudienceCorrespondencePreview key={person} projectId="project-a" inbox={inbox} />
  </ProjectAudiencePreviewScope>
</main>)
