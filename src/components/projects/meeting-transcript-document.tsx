import type * as React from "react"

import type { ClientMeetingTranscript } from "@/app/actions/project-client-meetings"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import type { ProjectBrand } from "@/lib/project-branding"

function inZone(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(iso).toLocaleString("en-US", { ...options, timeZone })
  } catch {
    return new Date(iso).toLocaleString("en-US", options)
  }
}

/** A project meeting's Google Meet transcript, printed with the department's logo. */
export function MeetingTranscriptDocument({
  brand,
  transcript,
}: {
  readonly brand: ProjectBrand
  readonly transcript: ClientMeetingTranscript
}): React.ReactElement {
  const { timeZone } = transcript
  const day = inZone(transcript.startsAt, timeZone, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  const time = (iso: string): string => inZone(iso, timeZone, { hour: "numeric", minute: "2-digit" })
  const zone = inZone(transcript.startsAt, timeZone, { timeZoneName: "short" }).split(" ").pop() ?? ""
  return (
    <>
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <ProjectBrandLogo brand={brand} size={64} className="h-16 w-16 shrink-0 object-contain" />
          <div>
            <p className="text-sm font-bold uppercase">{brand.companyName}</p>
            <ProjectBrandContactDetails brand={brand} />
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold uppercase tracking-wide">Meeting Transcript</h1>
          <p className="mt-2">{day}</p>
          <p>
            {time(transcript.startsAt)}–{time(transcript.endsAt)} {zone}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-semibold">Meeting</dt>
        <dd className="min-w-0 break-words">{transcript.title}</dd>
        <dt className="font-semibold">Project</dt>
        <dd className="min-w-0 break-words">
          {transcript.projectNumber ? `${transcript.projectNumber} · ` : ""}
          {transcript.projectName}
        </dd>
        <dt className="font-semibold">Host</dt>
        <dd>{transcript.hostName}</dd>
        {transcript.guestEmails.length > 0 ? (
          <>
            <dt className="font-semibold">Guests</dt>
            <dd className="min-w-0 break-words">{transcript.guestEmails.join(", ")}</dd>
          </>
        ) : null}
        {transcript.staffEmails.length > 0 ? (
          <>
            <dt className="font-semibold">Staff</dt>
            <dd className="min-w-0 break-words">{transcript.staffEmails.join(", ")}</dd>
          </>
        ) : null}
      </dl>

      <section className="mt-6 border-t border-black pt-4">
        {transcript.text ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{transcript.text}</p>
        ) : (
          <p className="text-sm">
            Google saved this transcript, but its text could not be read. The PDF is in the
            project&apos;s Meeting Notes folder in Drive.
          </p>
        )}
      </section>
    </>
  )
}
