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

## Scrolling and long content

- Long pages, document editors, growing forms, dialogs, sheets, and overflowed
  lists must show a visible scrollbar by default whenever their content exceeds
  the available space. Do not require hover, wheel scrolling, or field focus to
  reveal that more content is available.
- Wide tables, code blocks, and overflowing navigation or filter rows must also
  expose a horizontal scrollbar when needed. Short content must not show an
  empty scrollbar.
- Use the shared theme-aware scrollbar styles. Native scrollbars are visible by
  default; the shared `ScrollArea` uses `type="auto"` so its custom bar remains
  visible while content overflows. Do not add local scrollbar-hiding styles.
- A custom scrollbar may suppress the native bar only when it provides an
  equivalent visible, draggable bar. Never show duplicate bars for one region.
- Use `compass-content-scroll` on primary page/form scroll regions to reserve
  scrollbar space and prevent fields or actions shifting as content grows.
- Keep scroll regions bounded with `min-h-0`/`min-w-0` as needed. Focusing a field
  or opening an editor must scroll its content region while the dashboard frame
  remains stationary. Users must be able to return to earlier content without
  refreshing the page.
- Personal sidebar photos must remain compact and must not grow with sidebar
  width at the expense of navigation space. Use crisp rectangular photo edges,
  without a frame, shadow, or feathering, beside the compact Help, Feedback, and
  Settings links.
- Keep personal/sidebar utility actions in a bottom mini drawer with a visible
  Compass trigger. Reveal it on intentional hover, keyboard focus, or click/tap;
  support pinning it open. Unpinned previews overlay navigation without shifting
  it; pinned drawers reserve space while the navigation keeps its visible
  scrollbar above. Keep photo/device popovers usable and active voice controls
  available. Respect reduced motion and keep collapsed/mobile sidebars usable.
- Expanded navigation groups must grow when nested sections open. Completed
  animations must release fixed dimensions so later items remain reachable.
- Scrollbars must work with pointer dragging, keyboard navigation, and touch;
  use semantic theme colors that remain visible in light and dark themes.

## Responsive behavior and accessibility

- Responsive layouts must remain usable at narrow widths; do not merely scale
  down a desktop layout.
- Dialogs and alert dialogs must be centered against the viewport, not offset by
  a sidebar, page container, scroll position, or other layout region. Use the
  shared dialog primitives instead of positioning modal content locally.
- Dialogs must fit within the dynamic viewport with a minimum two-unit inset and
  must scroll internally when content is taller than the available space. Footer
  actions must remain reachable without relying on page scrolling.
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

For scrolling changes, verify long and short content, growing document/form
content, horizontal overflow, visible bars with the pointer outside the region,
light/dark themes, mobile behavior, and stationary dashboard framing.
