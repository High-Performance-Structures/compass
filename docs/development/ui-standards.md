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
  `bun run ui:check` rejects hex classes such as `text-[#9d832c]` in
  components; use the named token (`text-brand-nutech-gold`) or add one to
  `globals.css` first. Literal colors stay legitimate in HTML email bodies
  (email clients ignore CSS variables), in saved color choices users pick
  from, in CSS handed to third-party call SDKs, and on the public landing
  page.
- Keep information surfaces predominantly flat. Cards, badges, pills, and
  other bordered bubbles should occupy no more than roughly 20% of an
  informational layout.
- Use the global radius scale. Reserve circular shapes for intrinsically
  circular controls such as avatars, status dots, switches, progress tracks,
  and round icon buttons.
- Prefer whitespace, typography, and dividers over nested bordered containers.
- Use Lucide or Tabler icons consistently and give icon-only controls an
  accessible name.

## Theme tokens, density, and elevation

The default HPS theme lives in `src/app/globals.css` (`:root` and `.dark`).
Change the look of Compass by changing tokens there, not by restyling screens
one at a time.

- **Density.** The base spacing unit is `--spacing: 0.25rem`. Spacing,
  padding, gap, and control-height utilities scale from it. Do not tie
  structural widths (sidebar, drawers, fixed panels) to the spacing scale;
  give them explicit `rem` widths so navigation labels never wrap when density
  changes.
- **Surface roles.** Use `bg-background` for the page, `bg-card` and
  `bg-popover` for raised surfaces (white in light mode), `bg-muted` for quiet
  fills and table headers, `bg-secondary` for neutral buttons, and
  `bg-accent` for hover and selected states. The three fills must stay
  visibly distinct from one another and from the page.
- **Action color.** `bg-primary` is the deep HPS green and is reserved for the
  main action on a surface and for focus rings. Destructive actions use
  `bg-destructive` with `text-destructive-foreground` (white).
- **Borders.** `border-border` separates content; `border-input` outlines
  form fields and is darker so fields read as editable. Dark-mode borders must
  stay visible against both the page and card surfaces.
- **Status color.** Use `destructive` (error, overdue, blocked), `warning`
  (pending, needs attention), `success` (complete, paid, on track), and `info`
  (neutral notices) instead of stock red, amber, green, or blue. Status text
  uses `text-<role>`; tinted surfaces use `bg-<role>/10` with
  `border-<role>/30`; solid fills use `bg-<role>` with
  `text-<role>-foreground`. These tokens carry their own dark-mode values, so
  do not add `dark:` color overrides. Neutral grays use `muted`,
  `muted-foreground`, `foreground`, and `border`. `bun run ui:check` fails on
  stock palette colors outside vendored AI elements, print layouts, file-type
  icons, and the always-dark call window.
- **Department color.** HPS, ORC, Nu-Tech, and Compass brand tokens identify
  context (a department tab, logo, or marker). Do not use them as large
  background washes.
- **Elevation.** Use three levels only: flat (no shadow, optional border) for
  page content, raised (`shadow-xs` or `shadow-sm`) for cards and controls that
  sit above the page, and overlay (`shadow-lg` or higher) for popovers, menus,
  sheets, and dialogs. Do not stack shadows on nested containers.

- **Charts and the Gantt.** Chart and Gantt chrome (headers, grid, ticks,
  labels, popups) reads theme tokens so it follows light and dark mode. Item
  display colors chosen by people stay as chosen.

## Typography

- Body text is 14px (`text-sm`). Secondary text and table cells may use 13px;
  captions, badges, and meta text use 12px (`text-xs`).
- Do not use text smaller than 12px (`text-xs`). The only exceptions are
  print-only layouts, glyphs inside icon-sized count bubbles, avatar initials,
  and miniature file thumbnails; `bun run ui:check` lists the exempt files and
  fails on any other sub-12px size.
- Use `font-sans` (Sora) for interface text, `font-mono` (IBM Plex Mono) for
  codes and identifiers, and reserve `font-serif` (Playfair Display) for the
  dashboard greeting and similar single display moments.
- Money, quantities, percentages, and dates that line up in columns use
  tabular figures. Tables and numeric inputs get this globally; add
  `tabular-nums` to numeric values rendered outside a table.
- Uppercase labels are for short section eyebrows only, with a little letter
  spacing. Do not use uppercase for buttons or body labels.

## Page anatomy

- Each dashboard page starts with one header row built with the shared
  `PageHeader` component (`src/components/page-header.tsx`): optional back
  link, optional small grey label above the title (`eyebrow`, for context such
  as the project number or desk name), icon or department logo, title, and the
  page's actions aligned to the right. Do not hand-build page titles. Avoid
  stacking a second toolbar or launch strip above the content when its
  controls can join that header row.
- The title names the page ("Work calendar", "Feedback Desk"), never a
  sentence. All page titles use the header's one size.
- No explanation line under the title. If a note helps someone use the page,
  put it next to the thing it explains. Record facts that belong to the title,
  such as "Submitted Oct 3 · Owner: Dana", go in the header's `meta` line.
- Section and summary areas use thin rules (`border-b`, ruled `gap-px`
  strips) rather than rounded cards, following the 20% bubble rule.
- Dense workspace toolbars (Schedule) stay on one compact row and let the
  workspace scroll sideways at narrow widths. Fit them by shortening labels on
  smaller screens, keeping the full name as the accessible name and tooltip,
  and size selects to their content rather than fixed widths that clip labels.
- Keep the primary action visible without scrolling and give it the primary
  style. Secondary actions use outline or ghost buttons.
- Forms have a readable maximum width (`max-w-5xl` for multi-column editors,
  `max-w-2xl` for single-column forms). Short values (quantity, cost,
  percentage, dates, codes) use short fields instead of stretching across the
  page.
- When a list row opens a record, make the whole row the click target with
  `hover:bg-accent`, a visible inset focus ring, and an optional trailing
  chevron that strengthens on hover. Do not add a separate bordered arrow
  button for the same action.
- Show a badge or tag only when it distinguishes the item from its neighbors.
  If every row would carry the same tag, use a group heading instead.

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
- Choose the picker by list size and source:
  - more than six options, or options that come from business data
    (projects, people, statuses, catalogs): `SearchableCombobox`, or
    `SearchableComboboxField` inside a plain form. Search must include
    recognized identifiers and secondary labels.
  - six or fewer fixed options: the compact shadcn `Select`.
- Do not use native `<select>` in product UI; `bun run ui:check` rejects it.
- Pickers that save on change must ignore the combobox's empty reset and
  re-picks of the current value, so nothing saves or clears by accident.
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

For theme or token changes, compare before and after screenshots of the
dashboard, project hub, estimate, financials, and schedule in light and dark
themes and at phone width, and confirm that sidebar labels, toolbars, and
dialogs still fit.

For scrolling changes, verify long and short content, growing document/form
content, horizontal overflow, visible bars with the pointer outside the region,
light/dark themes, mobile behavior, and stationary dashboard framing.
