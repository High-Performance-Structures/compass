# Portfolio map

The office dashboard shows active jobs on a 3D relief of Colorado, carved as a
block, with a side panel of quick information and links into each job.

## Data

- **Jobs** come from `getPortfolioMapData()` (`src/lib/portfolio-map/load.ts`),
  which reuses `getProjects()` for visibility, so the map never shows a job the
  person cannot open. Schedule progress, past-due and stalled counts are
  aggregated in SQL.
- **Scope**: HPS and Open Range (construction and design) projects. Nu-Tech
  jobs are left off, using the project department or job-number prefix
  (`isMappedDepartment`). Projects with the built-in **Internal** job status
  (office records, Compass development and test projects) are left off too;
  the Project Hub has an Internal view for them.
- **Per-project override**: the project information page and the map panel
  set `portfolio_map_visibility` to `default` (follow status and department),
  `shown` (always on the map; statuses without a phase appear in closeout for
  warranty/complete jobs, pre-construction otherwise) or `hidden`. Hidden jobs
  are listed in the panel with "Show on map". "Add a project to the map" in
  the panel searches projects kept off the map by status or department
  (loaded on demand) and sets them to always show. Changes are audited.
- **Phase** comes from the job status (`phaseForJobStatus` in
  `src/lib/portfolio-map/model.ts`). Closeout covers punch list and warranty
  work. Complete, closed, refused, inactive, internal and material-order statuses (ordered, partial order, price sheet
  sent, shipping TBD, awaiting payment) are not shown. Custom statuses match a
  standard status by label.
- **Location** is town-level, without geocoding, in this order: the public
  town/city field; the town in the site address (with or without commas); the
  site address's Colorado ZIP code (`colorado-zips.json`, Census Bureau ZCTA
  gazetteer, public domain, labeled with the nearest town); then a trailing
  "- Town" in the project name. Towns come from OpenStreetMap
  (`colorado-places.json`). Only a trailing state is ignored, so "Colorado
  Springs" keeps its name. Jobs that cannot be placed are listed in the panel,
  each linking to its project information page, instead of guessed. Jobs in the
  same town are fanned out on a small ring.
- **Freshness**: job data is read on every dashboard load, so a newly added
  address or town appears on the next visit (a reload bypasses the browser's
  30-second page cache).
- **Names** use `projectDisplayName()`: the stored name without the job number
  repeated at its start; the job number is shown as a secondary label. Public
  titles are for social media and are not used.
- **Health**: past due when a schedule item ended before today below 100%;
  at risk when an item is in progress with 0% complete.

## Terrain and roads

`public/maps/colorado-terrain-v1.json` holds a 301 × 221 elevation grid
(AWS Terrain Tiles, from USGS 3DEP and SRTM) and simplified OpenStreetMap
motorway, trunk and primary roads. It is served with an immutable one-year
cache header (`public/_headers`); publish changes under a new file name.

Regenerate with `scripts/portfolio-map/build_terrain.py <folder>` after
downloading the zoom-7 Terrarium tiles covering Colorado and an Overpass export
of the roads into that folder. The map must keep showing the attribution
"Elevation: AWS Terrain Tiles (USGS 3DEP, SRTM) · Roads © OpenStreetMap
contributors"; OSM data is licensed under the ODbL.

## Performance and fallbacks

three.js and the scene load only when the section nears the viewport, in a
separate chunk. The scene renders on interaction only. Phones, reduced motion,
and browsers without WebGL 2 use the 2-D pipeline view; people can switch
between Map and Pipeline, and the choice is remembered per browser.

## Sub/vendor "Your jobs" map

Sub/vendors with two or more active jobs see a smaller version of the map on
their dashboard overview (`VendorJobMap`).

- **Which jobs:** only the projects already in the viewer's project switcher
  (`projectOptions`, resolved server-side from their project memberships).
  `getAudienceJobMap()` is a server-only loader, not a server action, so a
  client cannot request other project ids. Staff previews show only the
  current project, so the map stays hidden there.
- **Phase:** from job status alone (`phaseForJobStatus`); the office
  department filter and per-project map overrides do not apply. Complete,
  closed, internal, and order statuses are left out.
- **What the panel shows:** town, phase, and the vendor's own next scheduled
  items and commitment count, loaded on selection through
  `getProjectAudiencePreview(id, "sub_vendor")`. That is the vendor
  dashboard's own reader, so the panel never shows more than that dashboard.
  No office signals (progress, health, past-due counts) are sent.

## Owner "Where things stand" relief

Owners see their project on the same relief, zoomed to its town
(`OwnerSiteRelief`), beside an owner-worded stage stepper (Pricing, Design,
Permits, Getting ready to build, Under construction, Finishing up) and a
"scheduled work complete" bar.

- **General area only:** the pin is the town center from `resolveTown`, never
  the site address, and the panel says so. Without a resolvable town the
  section is not shown.
- **Progress:** `ownerScheduleProgress()` averages percent complete across
  the owner-visible schedule items already on the dashboard, weighted by
  workdays. No office-only schedule rows are read.
- Phones and reduced motion show the stepper and progress without the map.

## Per-job zone charges

Project Information has a **Zone charges for this job** section (office staff;
editors are the same roles as Settings → Zone charges). Each value is
optional, and a blank field keeps the organization default:

- distance zone (charge as a different zone), custom zone rate
- corrected site elevation (re-picks the mountain band), custom mountain rate
- lodging and per diem: as the zone sets it / yes / no, plus lodging-per-night
  and per-diem amounts
- a note

Adjustments live in `project_travel_charge_overrides` (migration 0194), apart
from the cached site columns that the background lookup rewrites. Changing
the defaults later does not change a job's adjustments. Every save and
"Use the defaults" (which removes the row) is written to the project's
audit history. `applyTravelOverride()` in `travel-overrides.ts` applies them
after `jobTravelCharge()`. The map panel marks such jobs "Custom for this job"
and links to the section. Adjustments stay inside the office-only travel data
and never reach owner or vendor views.

## Messages layer

Layers → **Messages** stacks one thin tile per unread bell item on each job
(colored by kind: messages, project mail, RFIs, schedule, other). The bell and
the layer are two views of the same inbox:

- Clicking a bell item still opens the item itself; it never opens the map.
- Clicking a job on the map shows **Unread for this job** at the top of the
  panel, with the bell's own rows: Open (same destination as the bell),
  Mark read, and Done. Either view's changes update the other immediately
  (`compass:notifications-changed` event).
- Each project section in the office bell has **Show on map**, which opens
  `/dashboard?layer=messages&job=<id>` with the layer on and the map zoomed
  to that job.

Only the viewer's own unread items with a project are stacked. Data comes from
`getNotificationCenter()` through `useNotificationInbox`. The layer loads it
only while the layer is on and the map is shown. The tiles are built in
`portfolio-message-stacks.ts`.
