# O-58-3674 operational cutover source manifest

Generated 2026-08-27 for Compass project `proj-bt-o-58-3674-forest`, Buildertrend job `5072748`, at 3674 Forest Lakes Drive, Monument, Colorado 80132.

## Scope

This cutover uses the existing Compass schedule, daily-log, and daily-log attachment mechanisms. It contains only the latest current Buildertrend schedule, neutral factual weather observations, and factual Fox Blocks procurement events. Prior schedule versions and non-operational materials remain outside Compass.

## Operational source inventory

| Category | Available records | Import handling |
| --- | ---: | --- |
| Buildertrend daily logs | 249 | Protected existing records; unchanged |
| Current Buildertrend schedule | 230 | Imported to current `schedule_tasks` with stable activity links |
| Buildertrend change orders | 28 | Protected existing staged records; unchanged |
| Buildertrend RFIs | 1 | Protected existing staged record; unchanged |
| Buildertrend RFQs | 0 | No source records available |
| Buildertrend estimate | 1 header / 37 categories / 90 line items | Protected existing records; unchanged |
| Buildertrend messages | 227 | Protected existing staged records; unchanged |
| Buildertrend pay-request source records | 21 | Protected existing staged records; unchanged |
| Neutral weather daily logs | 77 | Added as ordinary daily logs with deterministic source keys |
| Fox Blocks procurement daily logs | 7 | Added as ordinary factual daily logs with deterministic source keys |
| Fox Blocks document references | 12 | Added through ordinary daily-log attachment references |

The pay-request module attestation reports 39 observed source items while 21 `owner_invoice` staging records are present. This cutover preserves both values and does not infer or manufacture the missing reconciliation.

## Current schedule

- Live capture timestamp: `2026-08-27T04:57:12.745Z`
- Buildertrend source: https://buildertrend.net/app/Schedules/5
- Local source artifact: `o-58-3674-buildertrend-live-schedule-2026-08-27T045712Z.json`
- Google Drive audit copy: https://drive.google.com/file/d/1w4aHyaG7zVoJukkeHYFiKh9Q9LUgNpGx/view?usp=drivesdk
- Google Drive audit folder: https://drive.google.com/drive/folders/1xJFofP77qf1GNrRGQT6DCafjAgLebJyA

Prior captures are retained only as local/Drive audit references and are not imported into Compass. Two prior-only immutable Buildertrend staging rows remain `archive_only` because existing audit triggers prohibit deletion; they have no current schedule task, link, or user-facing promotion.

## Neutral weather sources

- NOAA/NCEI daily station observations: `USC00055733 Monument 3 S` and `USC00056280 Palmer Lake`, https://www.ncei.noaa.gov/access/past-weather/
- Open-Meteo historical point observations for explicitly identified dates at the verified project coordinates, https://archive-api.open-meteo.com/
- Time zone: `America/Denver`

Each weather log stores the provider, source kind, station or point status, observation period, temperature/precipitation/snow values available from the source, retrieval metadata, and source limitations. The entries contain no delay, no-work, impact, compatibility, or causation conclusions.

## Fox Blocks procurement sources

- PO 1541 original order form: https://docs.google.com/spreadsheets/d/18AEiWBed2msPc3x6DCc3E9Xxv0NgIN_U/edit?usp=drivesdk
- Project Lead Tracking row 243 / PO 1541: https://docs.google.com/spreadsheets/d/15DPCjDK9a4b3pkNB7ZdSFtJsSN1q2CyajNUBb40aRkE/edit#gid=1407034193&range=A243:O243
- Archived order-tracking workbook: https://docs.google.com/spreadsheets/d/1_VZdtfLDb5LAD7TkSLserzdzcEPqBWjW/edit
- Airlite acknowledgement 78145-EPS: https://drive.google.com/file/d/1xd2arVjekJxPhFdpZgCnUAekZhXIfIOe/view?usp=drivesdk
- Airlite acknowledgement 78146-EPS: https://drive.google.com/file/d/1xbkZje26rFQuDerUVXSVcZHzXmnKwVLy/view?usp=drivesdk
- Airlite invoice 189194-EPS: https://drive.google.com/file/d/1aboejTppo9yh7Hu6RSrzH52ypJcL05YQ/view
- Airlite invoice 189195-EPS: https://drive.google.com/file/d/1aXD9PbYrrmi_yNJuym4K9XxfFpgZEd--/view

The seven logs preserve the operational distinctions among PO issuance, internal order placement, requested arrival, requested ship dates, expected delivery window, order revision, shipment/unloading, second delivery, and first stacking. The recorded 76–78-day and 19–31-day intervals are factual procurement variances, not critical-path or compensable-delay conclusions.

## Import and verification

- Time Travel bookmark immediately before import: `000004d3-0000049e-000050d4-115abbe731fe5c0d6d5a653464d7417e`
- Atomic REST batch: 790 statements, 1,372,045 request bytes
- Manifest fingerprint: `5fa8b3227be0c92c09ace70bba03c50d7e4e973d4806fba9087ffc00e82b4511`
- Canonical SQL SHA-256: `c1c9f7122b3a554aa1ca1eb698aa8483528d8c5caa8d1e626bf3b7b540c6dfad`
- REST batch SHA-256: `2345279e74db61a1778bae13a02db9dc65a45e750fe26d642d8b0423e0ff0d08`
- Initial import: HTTP 200, 790/790 statements successful
- Identical rerun: HTTP 200, 790/790 statements successful

Final D1 verification found 230 unique current schedule tasks and links, 77 unique weather source keys, 7 unique procurement source keys, 12 valid Drive references, zero forbidden project-specific schema objects, and zero forbidden migration entries. Protected Buildertrend daily-log checksums remained `249 / 1992 / 40814 / 5976`; protected change-order checksums remained `28 / 196 / 21518`; excluded daily-log source `85012183` remained absent.

## Unresolved source gaps

- The current Compass Buildertrend register starts in October 2022, so exact Buildertrend source IDs/URLs for the September 1–2, 2021 unloading/stacking logs were unavailable and were not invented.
- No RFQ source records were available.
- Pay-request staging contains 21 source records while the module attestation reports 39 observed items; no destructive reconciliation was attempted.
