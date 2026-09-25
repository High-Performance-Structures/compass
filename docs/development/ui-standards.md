# Compass UI Standards

This is the canonical product UI standard for Compass. New UI and UI changes
must follow this document. Implementation details belong in the component
conventions; this document defines the user-visible behavior and visual rules.

## Lists and tables

- Use TanStack Table for interactive tabular data.
- Every paginated list or table must provide an **Items per page** control.
- The canonical page sizes are **25, 50, and 100**. The default is **25**.
- The page-size control and pagination controls must be available on desktop
  and mobile. Mobile uses the same behavior in a compact responsive layout.
- Show the current page and total page count, with first, previous, next, and
  last controls. Icon-only controls must have accessible labels.
- Preserve the current page when a record is edited or the source data is
  refreshed.
- Reset to the first page when search, filtering, or sorting changes the result
  set.
- If a mutation removes the current page, clamp the page to the last remaining
  valid page. Never leave the user on an empty invalid page.
- Use the shared `DataTablePagination` component for new and migrated tables.
- Lists without pagination still need a deliberate empty state and should not
  silently render an unbounded dataset when the collection can grow.

## Layout and visual language

- Use shadcn/ui with the New York style and the shared UI primitives.
- Use semantic theme tokens from `src/app/globals.css`; do not add literal
  product colors or stock Tailwind palette colors to product UI.
- Keep information surfaces predominantly flat. Cards, badges, pills, and
  other bordered bubbles should occupy no more than roughly 20% of an
  informational layout.
- Use the global radius scale. Reserve circular shapes for intrinsically
  circular controls such as avatars, status dots, switches, progress tracks,
  and round icon buttons.
- Prefer whitespace, typography, and dividers over nested bordered containers.
- Use Lucide or Tabler icons consistently and give icon-only controls an
  accessible name.

## Responsive behavior and accessibility

- Responsive layouts must remain usable at narrow widths; do not merely scale
  down a desktop layout.
- Content containers need `min-w-0`; meaningful user-entered prose should wrap
  with `break-words` and `whitespace-pre-wrap`.
- Truncate only when the complete value remains available through an intentional
  detail view or accessible affordance.
- Interactive controls must support keyboard navigation and screen readers.
- Use responsive dialogs/sheets with bounded height and scrollable content.
- Provide loading, empty, success, and error states for asynchronous workflows.

## Controls and forms

- Use React Hook Form with Zod for forms.
- Use `SearchableCombobox` as the default value selector for searchable or
  business-data choices. Search must include recognized identifiers and
  secondary labels.
- Do not add native `select` or new shadcn `Select` value pickers without a
  documented accessibility or platform reason. Existing compact fixed selectors
  may be migrated when their workflow is touched.
- Use `DropdownMenu` for commands/actions, not for selecting a value.
- Keep live selector options sourced from current server results or component
  props and recompute dependent selectors when their parent changes.

## Mutations and destructive actions

- User-visible mutations use server actions, explicit success/error results, and
  revalidation of affected paths.
- Any create or edit workflow must expose a permission-appropriate delete
  action where the record type supports deletion.
- Consequential deletion requires clear confirmation, authorization,
  dependency handling, and audit or recovery safeguards appropriate to the
  record.

## Release review

Before a PR that changes visible UI is merged or deployed, reviewers must check
this document. Any new or changed list/table must explicitly verify page-size
selection, mobile behavior, edit/delete page preservation, filtering behavior,
empty/loading/error states, and accessibility labels.
