Sidebar Component
===

The sidebar is the primary navigation surface in Compass. It's built as a set of composable React components that handle three distinct scenarios: desktop expanded, desktop collapsed (icon-only), and mobile (slide-out sheet). The complexity comes from making all three feel like the same component while using entirely different rendering strategies.


why it's complex

A naive sidebar is just a fixed div with some links. Compass's sidebar needs more:

- *State persistence.* If a user collapses the sidebar, it should stay collapsed when they refresh or return tomorrow. This means storing state in a cookie and reading it on initial render.

- *Mobile is a different paradigm.* On desktop, the sidebar pushes content. On mobile, it overlays as a slide-out sheet. Same children, same navigation structure, but the parent container and positioning logic are completely different.

- *Collapsed state must remain useful.* When collapsed to icons, the sidebar still needs to work: tooltips appear on hover, the active item is visible, keyboard shortcuts still toggle it. This means conditional rendering based on collapsed state, not just hiding content with CSS.

- *Smooth animations without layout thrashing.* Width transitions can cause expensive reflows. The sidebar uses `will-change` hints and animates on the compositor thread where possible.


the architecture

```
SidebarProvider (context + state)
└── Sidebar (renders differently by platform)
    ├── SidebarHeader (logo, branding)
    ├── SidebarContent (scrollable nav area)
    │   └── SidebarGroup (section with optional label)
    │       ├── SidebarGroupLabel (collapses to hidden)
    │       └── SidebarGroupContent
    │           └── SidebarMenu
    │               └── SidebarMenuItem
    │                   └── SidebarMenuButton (tooltip when collapsed)
    └── SidebarFooter (user menu, secondary actions)
```

`SidebarProvider` owns the state machine. It tracks:
- `open` / `state` -- whether the sidebar is expanded or collapsed (desktop)
- `openMobile` -- whether the sheet is open (mobile)
- `isMobile` -- viewport detection from `useIsMobile()` hook
- `toggleSidebar` -- the unified toggle function

The provider also sets up the keyboard shortcut (`Cmd+B` / `Ctrl+B`) and persists desktop state to a cookie with a 7-day expiry.


how rendering diverges by platform

On mobile (`isMobile === true`), `Sidebar` renders a Radix `Sheet` component. The children (header, content, footer) are the same, but they appear in a slide-out overlay rather than a persistent sidebar. This is why `SidebarProvider` tracks `openMobile` separately from `open` -- the states are independent.

On desktop, `Sidebar` renders a two-part structure:

1. **sidebar-gap** -- an invisible spacer that pushes the main content to the right. Its width matches the sidebar width, or shrinks to icon width when collapsed.

2. **sidebar-container** -- the visible sidebar, positioned `fixed` on top of the spacer. When collapsed with `collapsible="icon"`, it shrinks to icon width. When collapsed with `collapsible="offcanvas"`, it slides off-screen.

The gap-and-container pattern matters. If the sidebar were just `fixed` without the gap, the main content would render behind it on initial load, then jump right after JavaScript hydrates. The gap reserves the space in the layout so there's no layout shift.


the collapsed state problem

When `data-collapsible="icon"` is set, several things need to happen simultaneously:

- The sidebar width shrinks from `--sidebar-width` to `--sidebar-width-icon` (default 3rem)
- Button text disappears (hidden, not just transparent)
- Group labels fade out and collapse their margin to zero
- Icons center themselves in the remaining space
- Tooltips appear on hover for buttons that have them

The component handles this through CSS data attributes. The sidebar wrapper gets `data-collapsible="icon"` when collapsed. Child components use `group-data-[collapsible=icon]:` Tailwind selectors to respond:

```css
/* Buttons hide text and center icons */
group-data-[collapsible=icon]:justify-center!
group-data-[collapsible=icon]:[&>*:nth-child(n+2)]:hidden

/* Labels fade and collapse */
group-data-[collapsible=icon]:-mt-8
group-data-[collapsible=icon]:opacity-0

/* Group actions disappear entirely */
group-data-[collapsible=icon]:hidden
```

This approach keeps all the collapsed styling colocated with each component rather than managed centrally. The tradeoff is that the selectors are verbose and the relationship between parent state and child styling isn't explicit in TypeScript.


mobile-specific sizing

Mobile sidebars have different constraints: touch targets need to be larger (44px minimum), text should be bigger, and the sidebar itself can be wider since it's not competing for horizontal space.

The mobile sidebar is set to `20rem` (320px) with an `85vw` max cap to prevent overflow on narrow screens. The component applies mobile-specific overrides using a `data-mobile="true"` attribute on the Sheet content. Buttons and groups use descendant selectors:

```css
/* Larger buttons on mobile */
[data-mobile=true]_&:h-11
[data-mobile=true]_&:text-base

/* Larger icons */
[data-mobile=true]_&:[&>svg]:size-5

/* More padding in groups */
[data-mobile=true]_&:p-3
```

The `&` refers to the component being styled, and `[data-mobile=true]_&` means "this component when it's inside a mobile sidebar." This is more maintainable than checking `isMobile` in every component and conditionally applying classes.

Button sizes scale up significantly on mobile:
- `default`: 32px → 44px height
- `sm`: 28px → 40px height
- `lg`: 48px → 56px height


collapsed sidebar centering

When the sidebar collapses to icon mode, buttons need to center their icons within a 48px wide container. This sounds simple but has several constraints:

1. The collapsed width is `3rem` (48px)
2. SidebarGroup padding shrinks to `p-1` (4px each side), leaving 40px available
3. Button sizes when collapsed: `default` = 32px, `lg` = 36px

The button variants handle this:

```typescript
size: {
  default: "h-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!",
  lg: "h-12 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2!",
}
```

The key insight: buttons use `justify-center!` when collapsed, and hide all children after the first (the icon) with `[&>*:nth-child(n+2)]:hidden`. No manual translate offsets -- just clean centering.


state persistence and the flicker bug

The sidebar stores its open/closed state in a cookie so it persists across page loads and sessions. But this creates a hydration problem: the server doesn't know the cookie value when rendering the initial HTML, so it renders with `defaultOpen`. After hydration, JavaScript reads the cookie and updates the state.

For a long time this caused a visible flicker: the sidebar would render open, then snap closed (or vice versa) after hydration. The root cause was in `useIsMobile()`:

```typescript
// Before: undefined becomes false on first render, true after effect runs
const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined)
return !!isMobile

// After: consistently false until effect sets the real value
const [isMobile, setIsMobile] = useState<boolean>(false)
return isMobile
```

The original code started with `undefined`, and `!!undefined` returns `false`. But the type was `boolean | undefined`, so the first render treated everything as desktop (the undefined coerced to false). When the effect ran and set the actual boolean, the context re-rendered with different state. The fix was to initialize to `false` directly, so the behavior is consistent: not mobile until proven otherwise.


animation performance

The sidebar animates width changes with a 200ms transition. To make this smooth:

- `will-change-[width]` and `will-change-[width,left,right]` hint to the browser that these properties will animate, promoting elements to their own compositing layer
- `ease-out` timing feels more natural than `ease-linear` for UI transitions (fast start, gentle deceleration)
- The sidebar-gap and sidebar-container both transition for synchronized movement

A more performant approach would animate `transform: translateX()` for the sidebar and let the main content flow naturally, but this requires restructuring how the sidebar gap works. The current approach prioritizes correct layout over 60fps animation, which is the right tradeoff for a toggle that happens infrequently.


component reference

**SidebarProvider** -- wraps the entire app (or the section that needs a sidebar). Sets up context, keyboard shortcut, cookie persistence. Accepts `defaultOpen` to control initial state when no cookie exists. Sets CSS custom properties `--sidebar-width` and `--sidebar-width-icon` that children can reference.

**Sidebar** -- the container. On mobile, renders a Sheet. On desktop, renders the gap + fixed container pattern. Accepts `collapsible="icon"` (shrink to icons), `collapsible="offcanvas"` (slide off-screen), or `collapsible="none"` (always visible). Also accepts `variant="sidebar"`, `variant="floating"`, or `variant="inset"` for visual styling.

**SidebarTrigger** -- the hamburger button that toggles the sidebar. Typically placed in the site header.

**SidebarRail** -- an invisible hit area along the sidebar edge that toggles on click. Useful for re-opening a collapsed sidebar without reaching for the trigger button.

**SidebarHeader / SidebarFooter** -- sticky containers at top and bottom. Header usually holds the logo/brand, footer holds the user menu. Both reduce padding when collapsed (`p-1`) and increase on mobile (`p-3`).

**SidebarContent** -- the scrollable middle section. Overflow is handled here so the header and footer stay pinned. Hides overflow when collapsed to prevent scrollbar artifacts.

**SidebarGroup** -- a section of navigation, optionally with a label. Groups can be conditionally rendered based on context (e.g., show a files group when viewing a project). Reduces padding when collapsed, increases on mobile.

**SidebarGroupLabel** -- section heading. Fades out and collapses margin when sidebar is collapsed. Uses `transition-[margin,opacity]` for smooth animation.

**SidebarMenu / SidebarMenuItem** -- semantic list containers. Menu items are the atomic navigation units.

**SidebarMenuButton** -- the actual clickable item. Handles active states, tooltips (shown only when collapsed and not mobile), and proper icon centering. Accepts `asChild` to render as a Next.js `Link`. Sizes: `sm` (28px), `default` (32px), `lg` (48px) -- all scale up on mobile.

**SidebarMenuAction** -- a secondary action button on the right side of a menu item (e.g., a "new" button next to "Projects"). Hidden when collapsed.

**SidebarMenuBadge** -- a small badge for counts (e.g., "3" unread). Hidden when collapsed.

**SidebarMenuSub** -- nested submenu for hierarchical navigation. Hidden when collapsed.

**SidebarInset** -- wraps the main content. Responds to sidebar state to adjust its own layout (e.g., adding margin when the sidebar uses the "inset" variant).


common patterns

**Basic navigation:**
```tsx
<SidebarProvider>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <a href="/dashboard">Compass</a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Main</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map(item => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  </Sidebar>
  <SidebarInset>
    {children}
  </SidebarInset>
</SidebarProvider>
```

**User menu in footer:**
```tsx
<SidebarFooter>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg">
            <Avatar>...</Avatar>
            <div>
              <span>{user.name}</span>
              <span>{user.email}</span>
            </div>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>...</DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</SidebarFooter>
```

**Conditional group based on route:**
```tsx
const pathname = usePathname()
const showFilesGroup = pathname?.startsWith("/dashboard/files")

{showFilesGroup && (
  <SidebarGroup>
    <SidebarGroupLabel>Files</SidebarGroupLabel>
    <NavFiles />
  </SidebarGroup>
)}
```


gotchas

- **Don't skip SidebarProvider.** `useSidebar()` throws if called outside the provider. This includes the sidebar itself -- it must be a child of the provider, not a sibling.

- **Mobile state is separate.** Toggling the sidebar on mobile changes `openMobile`, not `open`. Closing the mobile sheet doesn't collapse the desktop sidebar.

- **Cookie state only applies to desktop.** The mobile sheet never persists its open state because it should always start closed.

- **Tooltips only show when collapsed.** A `SidebarMenuButton` with `tooltip` will only render the tooltip when `state === "collapsed"` and `!isMobile`. This prevents tooltip flickering during normal use.

- **The width variables can be overridden.** `SidebarProvider` sets `--sidebar-width` and `--sidebar-width-icon` as CSS custom properties. Parent components can override these by passing `style` to the provider. Compass's dashboard layout overrides `--sidebar-width` to `calc(var(--spacing) * 72)` for a wider sidebar.

- **Icon centering requires consistent markup.** The collapsed-state centering assumes buttons contain an icon followed by text. If the markup structure differs (e.g., icon after text, multiple icons), centering won't work correctly.

- **Mobile width is capped at 85vw.** The mobile sidebar uses `max-w-[85vw]` to prevent overflow on narrow screens, even though the target width is 20rem.
