# Compass Flow Audit - 2026-05-20

## Purpose

Audit navigation and workflow links from the standpoint of user flow. The main concern is avoiding silent project context changes, especially in project-specific tools such as RFIs, purchase orders, schedules, photos, daily logs, owner updates, budget, and contacts.

## Guiding rule

Compass should not guess a project for project-specific work. If the user is not already inside a project, the app should ask for the project first. If the user is already inside a project-specific tool, switching projects should keep the user in that same tool.

## Changes made

- Added an explicit project section picker at `/dashboard/projects/select`.
- Updated sidebar project-specific links to open the picker instead of silently opening the first project.
- Updated the command-menu schedule shortcut to use the picker when no project context is active.
- Added section-preserving project switchers to:
  - project schedule
  - budget
  - project contacts
  - owner updates
  - daily logs
  - photo review
- Confirmed RFIs and purchase orders already use the same project picker pattern.
- Updated dashboard attention links so RFI items land in the project RFI workspace.
- Updated dashboard operation links so purchase order items land in the project purchase order workspace.
- Updated work-calendar task-source links to point at the proper workflow homes.

## Flow checks

### Main sidebar

- Projects opens the project hub.
- Work Calendar opens the cross-project calendar.
- Owner Updates, Daily Logs, Photos, Budget, Project Contacts, and Project Schedule require project selection first when launched globally.
- RFIs and Purchase Orders open their global project-pick pages.

### Project hub

- Project cards and project action menus open specific project sections.
- Department and status filters keep users on the project hub.
- Project-specific action links are valid because they are rendered from a known project card.

### Project-specific pages

- RFIs, purchase orders, schedule, budget, contacts, owner updates, daily logs, and photos all provide a same-section project switcher.
- Back links return to the selected project dashboard.
- Cross-links inside a project, such as Daily Logs to Photos or Owner Updates to Daily Logs, preserve the active project.

### Dashboard and work calendar

- Attention/RFI links open project RFIs.
- Purchase order links open project purchase orders.
- Schedule task links open project schedule.
- Task-source links no longer point to generic project browsing unless browsing is the intended action.

## Remaining follow-up

- Add item-level detail routes or anchored focus for RFIs and purchase orders once those records need printable, shareable, or approval-specific detail screens.
- Review conversations and notifications when those modules get deeper project-thread routing.
- Re-run this audit after financials, email, and owner/sub portals are wired to real permissions.
