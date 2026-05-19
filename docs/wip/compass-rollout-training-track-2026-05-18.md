# Compass Rollout Training Track

Last updated: 2026-05-18

## Purpose

This track turns Compass progress previews into durable rollout training. Each video should serve two jobs:

- show the office what is changing while Compass is still being built
- become a reusable training asset when Compass replaces Buildertrend workflows

The tone should stay calm, direct, and project-first. The videos should feel like practical workflow guidance, not marketing.

## House Voice

Use the "Jarvis" narration direction established in the first Compass office preview:

- clear, steady, and composed
- warm without sounding casual or loose
- polished enough for owners and office staff
- concise enough that the workflow remains the focus

The first successful voice sample used ElevenLabs `Adam Stone - Smooth and Relaxed`.

## Video Sequence

### 1. Office Overview

Status: first preview complete and shared with the office.

Purpose: explain the direction of Compass and show that the app is becoming the central project workspace.

Primary audience: internal office staff.

Core flow:

- dashboard
- project list
- project summary
- schedule
- contacts
- contact review
- daily logs
- photos
- owner preview
- budget

Training conversion notes:

- keep this as the opening orientation video
- update screenshots after the next UI polish pass
- keep narration high-level rather than procedural

Current assets:

- `outputs/compass-preview-video/compass-office-preview-jarvis.mp4`
- Google Drive Developer/Compass copy: `compass-office-preview-jarvis.mp4`

### 2. Project Manager Workflow

Status: next recommended build and training target.

Purpose: teach a project manager how to start from a job and move through the daily operating loop.

Primary audience: project managers, office production staff, and internal admins.

Core flow:

- confirm project context and switch only when changing jobs
- review project summary and next schedule item
- open Sage-backed schedule in list, calendar, and Gantt views
- review assigned subs/suppliers and unresolved contact matches
- open daily logs and photo review
- prepare RFIs, RFQs, and scope questions
- prepare purchase orders and Sage commitments
- create or preview an owner update
- enter vendor bills and prepare owner draws/pay applications
- check budget/G703 status and owner-safe visibility
- review Google Drive / Apps Script intake handoffs

Product checks this video should force:

- project number search must be obvious on the project index, but project detail should assume the user is already in the job
- schedule items must show source, status, assignee, and next action
- contact review must preserve scroll position and hide approved groups
- photo permissions must clearly separate internal, owner, sub/vendor, and public share
- RFIs, RFQs, POs, vendor bills, and owner draw/pay application work should be project-scoped
- owner update preview must be reachable from the project page
- budget view must distinguish internal detail from owner view
- Google Drive and Apps Script intake should have an obvious handoff point, with Compass owning review, permissions, and publishing decisions

### 3. Owner Experience

Status: planned.

Purpose: show what an owner can see and how Compass turns field information into a readable update.

Primary audience: owners and internal staff supporting owners.

Core flow:

- owner dashboard or project preview
- latest approved update
- visible schedule milestones
- approved photo gallery
- owner-safe documents
- owner budget view
- sharing options for approved photos or updates

Product checks this video should force:

- owner-visible content must never include internal-only issue or delivery photos
- `O` jobs can show owner-approved cost-code detail
- `H` jobs should roll owner budget visibility up to overall categories
- owner sharing should tag the appropriate HPS/Open Range/NuTech identity only for approved content

### 4. Sub/Vendor Workflow

Status: planned.

Purpose: make the sub/vendor view simple enough that a subcontractor always knows which project they are working in.

Primary audience: subcontractors, suppliers, consultants, and internal staff supporting them.

Core flow:

- switch between assigned projects
- confirm active project context before messaging or uploads
- view assigned schedule items
- view relevant RFIs and files
- send a project message
- upload photos or updates to the correct project

Product checks this video should force:

- project switcher must be prominent and hard to miss
- schedule view must filter to visible/assigned work
- RFIs must be scoped to the correct vendor/project
- messages should make project context obvious
- upload targets must not accidentally attach to the wrong job

### 5. Admin Workflow

Status: planned.

Purpose: train the few users who can maintain registry, Sage mappings, permissions, and integration health.

Primary audience: Martine and designated secondary admins.

Core flow:

- enter edit mode for the project registry
- review Compass, Sage, Google Drive, and Buildertrend identifiers
- review contact source matches and directory assignments
- create or update contacts from Compass when Sage does not yet have them
- review Sage bridge/read-only sync status
- approve or publish owner-visible content

Product checks this video should force:

- registry should be hidden from normal internal users
- admins should explicitly enter edit mode before changing registry data
- TBD source names should stay ignored or unresolved until a real company/person is assigned
- internal entities include High Performance Structures, Open Range Construction, and NuTech Systems
- global contact directory should remain independent from project assignments

## Next Build Pass

The next Compass product pass should follow the Project Manager Workflow. It is the best forcing function because it touches the main daily loop:

1. Project context and project switching.
2. Sage-backed schedule visibility.
3. Contact assignments and unresolved source review.
4. Daily log and photo review.
5. RFIs/RFQs.
6. Purchase orders and Sage commitments.
7. Owner update preview/publish.
8. Vendor bills, owner draws, and pay applications.
9. Budget/G703 visibility.
10. Google intake/script handoff.

When this workflow feels natural, the owner, sub/vendor, and admin videos will have a stable product foundation instead of isolated screens.

## Google Scripts Handoff

The existing Google Apps Scripts should remain useful where they are lightweight and reliable: Google Form intake, Drive folder organization, sheet-to-email triggers, and simple event-driven notifications. Compass should not treat those scripts as the final workflow authority. They should feed records into Compass queues, where staff can review source data, set visibility, attach it to a project, and decide whether it becomes owner-visible or sub/vendor-visible.

Good first handoff targets:

- daily log form responses
- Telegram/photo staging records that land in Google Drive
- Drive folder and document metadata
- owner update email preview/draft helpers
- legacy Google Sheet schedule references during transition only

## Internal Role Model

Compass should not show every internal user the same amount of operational or development detail. The project page should eventually support role-specific lenses, with admin/developer tools hidden unless explicitly enabled.

Recommended internal roles:

- **Admin-owner**: sees the most inner workings for updates and continued build-out. Default should be worker mode. Developer mode should be explicit so project work is not cluttered by implementation controls.
- **Project Manager**: coordinates with the Assistant Project Manager and Field Superintendent on everything required to keep the job moving.
- **Assistant Project Manager**: updates schedules, processes POs, manages RFIs/RFQs, and prepares takeoffs for estimates.
- **Project Administrator**: maintains owner communication, prepares and sends weekly owner updates, enters vendor bills, and prepares monthly owner draws/invoices.
- **Field Superintendent**: communicates with the PM/APM on deliveries, schedule, onsite issues, and field needs.
- **Field Crew**: records day-to-day progress, challenges, needs, photos, and field notes.
- **Architectural Designer**: works through design decisions, owner selections, and plan/spec coordination.
- **Drafter**: handles drawings, revisions, details, and plan/document updates.
- **Lead Estimator**: owns estimate strategy, scopes, CSI/cost-code alignment, and bid packages.
- **Assistant Estimator**: supports takeoffs, vendor/sub pricing, RFQs, and estimate assembly.
- **Office Manager**: handles internal administrative work and can help with project administrative items. This may deserve a separate internal dashboard or an internal project/workspace rather than being forced into a client job page.

Near-term UI direction:

- project page now derives the starting role lens from the user's project membership role, then falls back to their Compass app role
- admin-owner worker/developer mode gate added so registry and integration controls are hidden during normal project work
- Sage active employees should seed the internal roster and provide first-pass role hints for PM, APM, project administrator, superintendent, field crew, design/estimating, and office manager views
- use project roles to change default filters and visible queues, not only card order
- keep project context obvious for every role
- explore an internal administrative project or separate dashboard for non-job office work
