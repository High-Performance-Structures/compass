# Project Registry Starter Mapping: Loomis and Loeffler

Date: 2026-05-13

This note records the first two Compass project registry mappings created during Phase 1. The goal is to seed obvious active projects so the registry UI can become useful before full Sage and Google Workspace sync exists.

## Mapping Rules Used

- Compass project number comes from the HPS project/folder nomenclature, with the known format `{TYPE}-{SEQUENTIAL}-{STREET_NUMBER}`, such as `O-170-2684` or `O-202-595`.
- The Compass project number is the end-user search/display key. Sage job IDs and Google IDs remain integration identifiers.
- The first character is the letter `O` for these ORC/Open Range Construction projects, not zero. Valid HPS prefixes are `O` for ORC/Open Range Construction, `N` for NuTech Systems, `H` for High Performance Structures, and `D` for design-only work.
- Google Drive root folder is the project folder found in Google Workspace.
- Schedule source is the clearest schedule spreadsheet/workbook found in the project folder or construction log folder.
- Sage-side project/customer identifiers come from the local Sage migration capture in `/Users/martine/Documents/Codex/2026-04-29/in-sage-100-contractor-what-is/outputs/translation_layer_data.json`.
- Daily log/photo/update sources are recorded as `project_external_links` rather than forcing them into sheet-only fields until the daily-log schema exists.

## Loomis

- Compass project ID: `proj-o-170-loomis`
- Compass project number: `O-170-2684`
- Project name: `O-170-2684 County Ln 7 - Loomis`
- Client: `Travis and Tanis Loomis`
- Address signal: `2684 County Ln 7`
- Google Drive root folder: `1AI7RBul8i3CZP-MN4BA2trALH_h7GSdV`
- Google Drive folder title: `O-170-2684 County Ln 7 - Loomis`
- Schedule sheet: `1zxH3CYZua2dCVnoGtntacfUleek6qG-etZpC5sCwZwA`
- Schedule title: `Schedule - O-170-2684 Loomis Residence`
- Construction log folder: `1imH4vOds9BZ_3hW6QnSJN4bkIkWKCSiq`
- Photo folder: `1_W1w-k2fvcWBU9FaUyJFB1Q6D-VsWVfg`
- Owner update seed: `2026-04-10_Loomis_OwnerLog_Week1`
- Sage project capture:
  - source path: `translation_layer_data.json` `projects_updated[616]`
  - primary Sage job ID: `620`
  - source/internal capture ID: `2630`
  - customer: `7 Travis and Tanis Loomis`
  - source project name: `O-170-2684 County Ln 7`

Confidence: high for Google folder, schedule, construction log folder, and Sage/customer/project name match. Medium for photo folder because photo workflows still need a formal Compass daily-log/photo schema.

## Loeffler

- Compass project ID: `proj-o-202-loeffler`
- Compass project number: `O-202-595`
- Project name: `O-202-595 Twinkle Rd Loeffler Residence`
- Client: `Alan and Deborah Loeffler`
- Address signal: `595 Twinkle Rd`
- Google Drive root folder: `1EzsxbZiPVVwxNBkTfdgEGMw-OopjCGrX`
- Google Drive folder title: `O-202-595 Twinkle Rd Loeffler Residence`
- Schedule workbook: `1j2-aIcynMDYhEfgZzuEkc9VJXvlLENuq`
- Schedule title: `Schedule_List_O-202-595 Twinkle Rd Loeffler Residence 5.13.26.xlsx`
- Construction log folder: `1svwKnUNfOP0TJ9-wnf1rM_occRHDNwZS`
- Progress photos folder: `1JekrftfmpXJO-ltp-iN3B_-fWWJ8xII2`
- Owner update seed: `2026-04-03_Loeffler_OwnerLog`
- Sage project capture:
  - source path: `translation_layer_data.json` `projects_updated[717]`
  - primary Sage job ID: `722`
  - source/internal capture ID: `2826`
  - customer: `23 Alan and Deborah Loeffler`
  - source project name: `O-202-595-Twinkle Rd-Alan and Deborah Loeffler`

Confidence: high for Google folder, construction log folder, and Sage/customer/project name match. Medium-high for schedule workbook because the latest file is an `.xlsx` workbook in Drive rather than a native Google Sheet.

## Notes For Next Pass

- Add a real daily log/photo schema before importing owner logs and progress photos as first-class Compass records.
- Treat the numeric `projects_updated.ID` value as the primary Sage job identifier. Example: Loeffler is Sage job ID `722`.
- Add a reconciliation screen that shows Compass, Sage, Google Drive, Buildertrend, and daily-log/photo sources side by side.
