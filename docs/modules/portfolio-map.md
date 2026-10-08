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
  (`isMappedDepartment`).
- **Phase** comes from the job status (`phaseForJobStatus` in
  `src/lib/portfolio-map/model.ts`). Warranty, complete, closed, refused,
  inactive and material-order statuses (ordered, partial order, price sheet
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
  same town are fanned out on a small ring. The internal office record
  (H-OFFICE) is not shown.
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
