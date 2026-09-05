# External workspace dashboard

Implements the approved internal-dashboard layout for owners and the shared sub/supplier workspace. The existing workspace shell owns account/logout, project selection and its remembered cookie, desktop and mobile navigation, notifications, appearance, and internal-preview controls.

The branch incorporates the existing permission-aware Quick Add feature from `6a0820b5` (#573). Its layout provider, header menu, server-authorized destinations, project picker, and creation entry hooks remain intact. Dashboard regression coverage uses the real Quick Add components for both audiences at desktop, tablet, and phone widths, including project selection, message navigation, partner RFI creation, and the absence of a menu when no actions are authorized. Review the dashboard diff against that integration baseline.

## Workflows

- Owner priorities: authorized schedule confirmations, change orders ready for owner review, and requests for more information that the viewer can edit. Published pay applications and recent updates appear separately from pending responses.
- Partner priorities: authorized schedule confirmations, RFQs without a vendor response, and purchase orders awaiting acknowledgment. Recent RFI answers and commitments remain accessible below the response queue.
- Quick links retain each audience's existing routes for budget, updates, RFQs, RFIs, commitments, change requests, plans/documents, and photos. Owner warranty requests appear when the project is in the warranty stage.
- Team contact details support phone/email access. The existing direct-message launcher remains in the dashboard and header. Expandable email/text instructions retain copying, routing tags, and SMS links.

Photos come exclusively from the authorized project/audience preview data. Up to six recent photos rotate with a fade into the greeting. Project/audience/photo-source changes reset the carousel; failed photos are removed; zero photos show a standardized, generated custom-home inspiration photograph with a theme-aware fade into the greeting (see `external-dashboard-placeholder.md` for asset provenance and prompt); one photo hides rotation controls. Reduced motion disables autoplay. Manual next pauses autoplay.

The five-day horizon follows the internal dashboard's default Mountain time calendar and becomes an agenda on phones. Optional financial-summary failures remain visibly unavailable while the dashboard and destination links still render.

## Scope and review baseline

Owner boundary: external dashboard presentation and links to existing guarded workflows. Server readers, mutation contracts, authentication, project membership, and financial approvals remain with their current owners. The two additional summary reads explicitly request the current external audience, including for internal preview users.

Production changes: the dashboard model, async summary loader, dashboard view, photo carousel, overview integration, two record anchors, and shell labels/breadcrumb. The original user request also authorized useful missing workflows; these additions expose existing response/review capabilities without creating a separate supplier product or new approval protocol.

## Verification

Run focused Vitest coverage for the dashboard model and summary loader, plus existing audience access, routes, remembered-project selection, direct-message destinations, financial audience filtering, and quote/PO response contracts. TypeScript and ESLint cover the changed code.

`node scripts/verify-external-dashboard.mjs` renders the real dashboard, workspace shell, account menu, project combobox, photo carousel, communication instructions, and RFI form in an isolated browser fixture. It checks desktop/tablet/mobile layouts, the logout action handoff, project selection/cookie/section retention, RFI submission and internal-preview blocking, theme switching, and photo behavior. Authentication and server mutations are stubbed at their boundaries; this does not test a live WorkOS session or write live records.

Set `DASHBOARD_SCREENSHOTS` to an existing output directory to retain screenshots. The fixture uses approved mockup photos when present and the repository logo otherwise, so the check runs without downloading external assets.
