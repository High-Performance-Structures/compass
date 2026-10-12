# Rate book

Settings → **Rate book** is the shared list of accepted rates estimators pick
from: labor, machines, delivery, fuel, travel/zone, lodging and per diem,
equipment rental, material, subcontract and other.

## Entries

Each entry has a name, category, unit (hr, man-hr, gal, day, trip, …), cost
per unit, default markup, an optional CSI/Sage cost code (from the same
catalog estimates use), notes, and, for fuel-bearing rates, a fuel type and
gallons per unit. The fuel fields support a later fuel-cost review.

- **Editors:** the zone-charge editors (administrators, company owners,
  office manager, project administrators, estimators). Other office staff can
  view.
- **History:** every save bumps the entry's version and stores a snapshot with
  an optional reason in `rate_book_entry_history`. Retire and restore are
  recorded too.
- **Retire vs delete:** retired rates leave the estimate picker but stay on
  record. Delete is offered only for rates no estimate has used, with
  confirmation.

## In estimates

In a line's cost breakdown, **From rate book** fills description, unit, cost,
markup and, when set, the cost code. The picker also lists this job's zone,
mountain, lodging and per diem charges, including per-job adjustments
(`getProjectTravelCharge`).

Values are copied into the estimate. The cost item keeps `rate_book_entry_id`
and `rate_book_version`, so later rate changes never alter an existing
estimate silently. When the rate book has a newer version, the item shows
"Rate book has a newer rate", and **Review new rate** opens the item with the
new values to save or discard.

Tables: `rate_book_entries`, `rate_book_entry_history`, and the two columns on
`project_estimate_line_cost_items` (migration 0196).
