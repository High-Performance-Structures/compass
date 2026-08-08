# YouTube API audit form draft — Compass

This is a working draft for Google's Audit and Quota Extension Form. Confirm all
legal and contact information before submission.

## Request

- Request type: Initial API compliance audit to remove the private-only upload
  restriction. No quota increase is presently required.
- Applying as: An organization / registered business
- Organization legal name: Open Range Construction, Ltd.
- Primary contact legal name: **Martine to confirm exact legal name**
- Contact email: martine@openrangeconstruction.com
- Business address: **Martine to provide/confirm**
- Phone: **Martine to provide/confirm**

## API client

- API client name: Compass
- Does the name contain “YouTube”?: No
- Primary access URL: https://compass.openrangeconstruction.ltd
- Privacy Policy: https://compass.openrangeconstruction.ltd/privacy
- Terms of Service: https://compass.openrangeconstruction.ltd/terms
- Publicly accessible: No. Compass is an authenticated, invite-only project
  management service. Public Privacy and Terms pages are accessible without a
  login.
- Google Cloud project number: **Pending authenticated Google Cloud lookup**
- Use-case category: Video Uploading & Account Management
- Secondary category if offered: Internal Company Tool

## Short use-case summary

Compass is an authenticated construction project-management application used by
Open Range Construction, Ltd., its affiliated operating departments, invited
project owners, subcontractors, and suppliers. Authorized internal staff can
upload a project video from a device or route a video received through a project
text/email intake. Compass stages the source in the project's Google Drive video
folder. Staff review the title, description, company YouTube channel, Compass
audience, and YouTube visibility, then explicitly publish the selected video.
Compass stores the resulting YouTube URL on the project video record and, when
requested, the related Daily Log. Compass does not offer YouTube search,
recommendations, advertising, analytics, bulk channel scraping, or a substitute
YouTube viewing service.

## End users

- Internal employees and authorized company administrators
- Invited custom-home owners and project clients
- Invited subcontractors and suppliers

Only authorized internal staff can connect a YouTube channel or publish a video.
Owners, subcontractors, and suppliers may receive a permitted project link but
cannot connect company channels or publish through the API.

## Why YouTube API access is necessary

Compass routes project videos to the appropriate existing company channel (ORC,
HPS, or Nu-Tech) without requiring staff to download the file, leave the project
context, manually upload it in YouTube Studio, copy the link, and return to the
correct Daily Log. The integration preserves project context, creates an
auditable publication workflow, and reduces the risk of publishing to the wrong
channel or audience.

## OAuth and data usage

Requested scopes:

- `openid`
- `email`
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.upload`

Compass uses OAuth identity to label the connected company account, read-only
channel access to confirm the managed channel ID and title, and upload access only
after an authorized staff user explicitly publishes a reviewed video. Refresh
tokens are encrypted at rest and remain server-side. Compass does not sell API
data or use it for advertising or unrelated profiling.

## User controls

- The connection screen identifies every connected company channel.
- Authorized staff can disconnect a channel from Compass.
- Disconnect removes the stored connection record and attempts OAuth token
  revocation.
- Google users may independently revoke Compass from Google Account permissions.
- Staff can archive or delete the Compass video record.
- Channel managers can delete an already-published video in YouTube Studio.
- Public publication requires an explicit confirmation.

## Expected usage

- Three managed company channels
- Internal construction-project videos, typically short field demonstrations,
  progress documentation, or instructional clips
- Expected volume: well below 100 uploads per day
- Requested quota: default quota; no extension requested unless the form requires
  a numeric request for the initial audit

## Reviewer access

- Demo URL: https://compass.openrangeconstruction.ltd/login
- Demo account: **Create a time-limited reviewer account after Google requests or
  immediately before submission**
- Reviewer role: internal test user with access only to a non-production audit
  project and a test YouTube connection
- Reviewer instructions: **Attach final step-by-step after the evidence build is
  deployed**

## Evidence files

Combine screenshots and diagrams into one PDF smaller than 10 MB if the form
offers one evidence field. Otherwise upload the separately labeled PNG/PDF files
listed in `youtube-api-audit-2026-08-07.md`.

## Final attestations requiring Martine

- Confirm all company and contact information is exact.
- Confirm the submission is complete and truthful.
- Accept the YouTube API Services Terms of Service.
- Accept the Google Privacy Policy acknowledgment.
- Accept the Developer Policies acknowledgment.
- Accept the demo-account waiver if reviewer credentials are supplied.
- Consent to Google's processing of the submission and support-call recording.
- Submit the form.
