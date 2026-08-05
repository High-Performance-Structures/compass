# Incomplete Buildertrend capture reviews

Files in this directory preserve authenticated Buildertrend evidence that is
not complete enough for a Compass template-content release. They are audit
records only:

- the next-batch assembler reads only immediate JSON files under
  `../fragments/`;
- incomplete reviews must not appear in the release manifest's `templates`
  allowlist;
- missing source rows or values must be recovered from a supported
  Buildertrend view or export, never inferred from copied content;
- a review may move to `../fragments/` only after every source module count,
  native identity, hierarchy, and documented conversion warning is resolved.

## Architectural Woodwork (`12796241`)

The source inventory and copy workflow report 19 tasks, while authenticated
All Tasks views for both the source and copied template expose the same 18
non-deleted root tasks. The deleted-task view is empty and the grid ends at
`Add task`, leaving one task without a recoverable native ID or title.

The review nevertheless preserves the exact five selections (65 choices), two
bid packages (five line items), and the three Buildertrend copy warnings for
unidentified bid lines whose multiple Cost Type assignments were cleared.
Its four schedule items and three dependencies remain in the canonical
reviewed 40-template source capture and are referenced rather than duplicated.
Architectural Woodwork remains blocked until the nineteenth task and the three
affected source Cost Type assignments can be recovered without inference.
