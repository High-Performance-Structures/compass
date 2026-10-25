export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getClientMeetingTranscript } from "@/app/actions/project-client-meetings"
import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { MeetingTranscriptDocument } from "@/components/projects/meeting-transcript-document"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { printProjectAccess } from "@/lib/print/print-access"
import { printPdfHref } from "@/lib/print/print-documents"
import { projectBrandFor } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function MeetingTranscriptPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ meetingId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const meetingId = query.meetingId
  if (!meetingId) notFound()
  const { project } = await printProjectAccess(projectId)
  // Transcripts are internal: the loader admits staff only.
  const transcript = await getClientMeetingTranscript(projectId, meetingId)
  if (!transcript.success) notFound()
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: project.department,
    projectId,
    projectNumber: project.projectNumber,
  })
  const number = `Transcript ${transcript.data.startsAt.slice(0, 10)}`
  return (
    <>
      <DocumentReportActions
        title="Meeting transcript"
        documentNumber={number}
        pdfHref={printPdfHref({ projectId, document: "meeting-transcript", params: { meetingId }, number })}
      />
      <main className="mx-auto my-4 max-w-[8.5in] border bg-report-paper p-8 text-xs leading-tight text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white !important; } }"}</style>
        <MeetingTranscriptDocument brand={brand} transcript={transcript.data} />
        <PrintSourceMode />
      </main>
    </>
  )
}
