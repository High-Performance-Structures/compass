# Compass Client Portal Stability Principles

Last updated: 2026-05-29

## Why This Matters

Compass is replacing Buildertrend for HPS owner, subcontractor, vendor, field,
and office workflows. Some HPS clients are technically sophisticated and already
have a low tolerance for Buildertrend friction. Compass cannot win by being the
same experience with nicer styling.

The client-facing standard is higher:

- Owners should quickly see what changed, what comes next, what needs their
  attention, and what they can confidently share.
- Subcontractors and vendors should always know which project they are working
  in before they send a message, RFI, schedule note, or commitment response.
- Staff should be able to preview owner and sub/vendor views without guessing
  what the outside party can see.
- The interface should feel polished, reliable, and steady rather than changing
  shape every day.

## Product Rule

Separate Compass into two layers:

1. Stable user shell.
2. Internal/developer buildout.

The stable user shell includes owner views, sub/vendor views, project briefing,
messages, visible photos, published updates, RFIs, P.O.s, and schedule readouts.
These screens should keep a consistent layout and mental model after a pattern
is accepted.

The internal/developer buildout includes registry fields, Sage/Google/Buildertrend
mapping, import review queues, sync diagnostics, permission shaping, and
experimental controls. These can change more quickly, but they should stay behind
admin/developer mode or internal-only screens.

## Practical Standard

For client-facing and subcontractor-facing screens, prefer improving data,
permissions, reliability, and polish without moving the furniture.

A change is appropriate when it:

- fixes a broken link, unsafe permission, misleading label, or confusing workflow
- makes the intended next action more obvious
- improves loading, empty, error, or no-access states
- makes project context clearer
- improves readability without changing the core page shape
- supports a published/approved record contract

A change should be treated cautiously when it:

- moves primary sections around after users have seen the screen
- renames core concepts without a migration reason
- exposes integration IDs or developer controls to owners/subs
- requires users to relearn where the same information lives
- adds a decorative element that does not improve clarity or trust

## Owner View Contract

The owner view should behave like a calm project briefing:

- current project identity
- latest published owner update
- approved photos
- what happens next on the schedule
- clear owner-visible decisions/messages
- share/export options only for approved owner-visible material

The owner view should not expose raw Google Drive folders, internal issue photos,
delivery/admin photos, Sage IDs, Buildertrend archive artifacts, registry fields,
or developer diagnostics.

## Sub/Vendor View Contract

The sub/vendor view should behave like a project-specific work lane:

- current project context is visible but compact
- switching projects is available only when the user has access to more than one
- schedule items, RFIs, commitments, documents/photos, and messages are scoped to
  that project
- sending messages or RFIs should not silently default to the wrong project
- project-specific permissions determine visibility

Sub/vendor screens should favor clarity over density. If a subcontractor is on
multiple jobs, the project selector must be obvious enough that they do not send
project communication from the wrong context.

## Internal Preview Rule

Internal users need preview controls because support conversations often require
staff to see what the owner or subcontractor sees. Preview controls are an
internal/admin convenience, not part of the eventual outside-user portal chrome.

Keep preview controls small, consistent, and clearly labeled as internal preview
tools.

## Backend Reliability Rule

Client-facing polish depends on behavior as much as visuals:

- links must route to the expected workflow
- pages must have stable empty states
- data must be approved before becoming owner/sub visible
- sync outages should show stale/pending state rather than breaking the page
- external integration failures should not make Compass unusable
- published owner updates should become durable snapshots
- visibility changes should be auditable

Compass can keep evolving quickly internally, but the outside experience should
feel steady, deliberate, and trustworthy.
