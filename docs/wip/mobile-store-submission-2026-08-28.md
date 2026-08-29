# Mobile store submission — 2026-08-28

This is the canonical first-release copy and console checklist for the public
iOS and Android listings. Installation is public; useful workspace access still
requires a Compass account and organization membership.

## Release decisions

- Distribution: public Apple App Store and public Google Play.
- Access: account-controlled; organizations decide who can access their data.
- Initial territory: United States. Add territories after the field pilot and
  support process are stable.
- Price: free download, no advertising, and no native in-app purchases in the
  first release.
- Release control: manual release after approval on Apple. Google publishes a
  first production release to all selected users, so keep initial territory and
  reviewer access deliberate.
- Identifiers: `com.hpscolorado.compass` on both platforms.
- Display name: `Compass`.
- Version: iOS `1.0` build `38`; Android `1.0.0` version code `18`. Increment
  each platform's build number for every uploaded binary.

## Listing copy

### Name

Compass

### Apple subtitle

Construction field workspace

### Google short description

Keep construction teams, project records, and field work connected.

### Full description

Compass connects construction teams, project participants, and the office
in one secure workspace.

Field teams can keep working when jobsite connectivity is unreliable. Download
assigned project information, review current work, create daily logs, capture
photos and files, and let Compass synchronize queued updates when service
returns.

Use Compass to:

- Open assigned projects and field information
- Review schedules, tasks, documents, and project conversations
- Create daily logs and attach jobsite photos
- Queue supported field updates while offline
- Receive project notifications and open linked records directly in the app
- Protect cached project information with device biometrics

Compass access is controlled by account, organization, project membership, and
role. Some features require an organization administrator to configure them.

### Keywords for Apple

construction,projects,field,daily logs,schedule,documents,photos,team

### Categories

- Apple primary: Business
- Apple secondary: Productivity
- Google Play: Business

### URLs

- Marketing: `https://compass.openrangeconstruction.ltd/`
- Support: `https://compass.openrangeconstruction.ltd/`
- Privacy: `https://compass.openrangeconstruction.ltd/privacy`
- Account deletion: `https://compass.openrangeconstruction.ltd/account-deletion`
- Terms: `https://compass.openrangeconstruction.ltd/terms`

## Brand boundary

- Compass owns the public store listing, app icon, launch experience, and
  unauthenticated sign-in experience.
- Organization branding begins only after sign-in and organization selection.
  For example, users entering the HPS organization see HPS branding inside its
  workspace; another customer can use its own name and visual identity.
- Store screenshots should use Compass and a clearly fictional demonstration
  organization, not imply that the app is exclusive to HPS.

## Screenshot plan

Use representative demonstration data only. Do not expose real customer,
project, address, financial, contact, or jobsite information.

1. Field home with assigned demonstration projects.
2. Project overview showing current field work.
3. Schedule or task view.
4. Daily log creation with demonstration attachments.
5. Project documents available to the signed-in reviewer.
6. Project conversation or notification deep link.
7. Offline banner plus queued work, if the state can be explained clearly.
8. Biometric protection screen, without showing a real user's device details.

Capture the highest-resolution required phone size for each platform. Because
the iOS target currently supports iPad, include current iPad screenshots or
remove iPad support before submission if the tablet experience is not ready.
Google Play should receive phone screenshots and tablet screenshots only when
the tablet layout has passed the same release matrix.

The repository now contains publication-safe Google Play assets under
`store-assets/`: the 512 px Compass icon, a 1,024 × 500 feature graphic, and
two 1,280 × 720 demonstration screenshots for Field Mode and CHERISH. The
feature graphic was generated with AI and must be the only asset labeled as
AI-generated in Play Console.

## Reviewer account

Create a durable reviewer identity and demonstration organization outside this
repository. Do not put its password or recovery secrets in source control.

The current reviewer identity is `testflight-review@hps-colorado.com`. It is a
verified WorkOS user with client access to the Open Range Construction
demonstration organization and Apple Review Sample Project. Confirm its
password on a fresh native install before entering it in either console.
The production password-reset email was sent on August 28, 2026; the account
holder must set and test the new password without putting it in chat or source
control.

Required characteristics:

- reusable email/password credentials;
- no expiring invitation, one-time code, SSO dependency, or mandatory MFA;
- works from Apple and Google review locations;
- one demonstration organization and at least one populated project;
- permission to view field home, schedule, daily logs, documents, messages,
  notification settings, and Account Settings;
- no access to real production customer or employee data.

Enter the credentials in App Review Information and Play Console App Access.

## Apple review notes

Use the following text, replacing bracketed reviewer credentials only inside
App Store Connect:

> Compass is a construction project-management service. The App Store
> listing is public, while organization and project information remains
> protected by account, membership, and role. Use the review account provided
> below to access a demonstration organization with non-production data.
>
> The app is not a simple website wrapper. Its native field workflow includes a
> bundled offline workspace, durable device storage for assigned project data,
> offline mutation and attachment queues, native camera/photo integration,
> biometric protection, push notifications, network-state handling, background
> file upload, native keyboard/status-bar handling, and Universal Links.
>
> To review: sign in, open the demonstration project, review its schedule and
> documents, create a demonstration daily log, and open Account from the user
> menu. Account deletion can be initiated under Delete Account. Camera, photo
> library, notifications, and biometrics are optional and can be denied without
> preventing sign-in.

Do not claim that Compass requests live location. It preserves GPS metadata
already present in a selected or captured photo and may upload that metadata
with the project attachment.

## Google Play App Access instructions

Use the reviewer account described above. State that all principal features are
available after ordinary email/password sign-in and that no special geographic,
membership, hardware, or paid entitlement is required for the demonstration
organization.

Suggested instructions:

1. Launch Compass.
2. Sign in with the supplied reusable email and password.
3. Select the demonstration project from Field Home.
4. Review Schedule, Daily Logs, Documents, and Messages.
5. Open the user menu and Account to review account-deletion controls.

## Preliminary privacy and safety answers

Console answers must reflect the actual release build and all server-side
providers. Complete a final data-flow review before attesting.

Expected declarations for app functionality and account management include:

- name, email address, optional phone number, and optional address;
- authentication and organization membership information;
- project messages, photos, videos, files, daily logs, and other user content;
- financial or contract records users are authorized to enter or review;
- device or installation identifiers used for push notifications;
- app activity and security/audit events;
- precise location when it is embedded in photo metadata that a user uploads.

Current intended answers:

- no advertising;
- no cross-app tracking and no sale of personal information;
- collection is linked to identity where required to provide the service;
- data is encrypted in transit;
- users can request deletion in the app and at the public deletion URL;
- retained construction, contract, financial, security, and audit records are
  governed by organizational and legal retention requirements.

Because Compass includes project conversations and uploaded content, answer the
store questionnaires about user-generated content truthfully. Confirm that
authorization, reporting/support, and moderation/administrative controls are
described adequately before submission.

The release candidate includes a per-message Report action, routes reports to
the administrative moderation queue, retains administrator delete/deactivate
enforcement, and publishes community rules at
`https://compass.openrangeconstruction.ltd/community-guidelines`.

## Current console state

- iOS `1.0` build `38` uploaded successfully and is processing in App Store
  Connect/TestFlight.
- The Google Play organization developer account is verified. Six of 11
  initial setup tasks are saved: privacy policy, ads, government apps,
  financial features, health, and Business category/contact details. Store
  listing text, icon, feature graphic, and two phone screenshots are staged;
  Play's AI declaration is prepared with only the feature graphic selected.
  App access, content rating, target audience, Data safety, and the final store
  listing save remain.
- App Store Connect requires an interactive Apple sign-in in the in-app browser
  before its app record,
  privacy labels, screenshots, reviewer access, and release settings can be
  completed.
- Console changes are staged only after the responsible account holder confirms
  the reviewer credentials and final privacy declarations.

## Console completion checklist

### Apple

- Agreements and organization contact information are current.
- App record uses public distribution and bundle ID
  `com.hpscolorado.compass`.
- Xcode archive is built with Xcode 26 or newer and the current required SDK.
- Distribution profile includes Push Notifications and Associated Domains.
- The archive contains the app privacy manifest with the required reasons for
  Capacitor Preferences and Filesystem.
- Apple OAuth is enabled in WorkOS and succeeds from the release build.
- App Privacy answers include the application and integrated providers.
- Updated age-rating questions are complete.
- Export compliance is answered; `ITSAppUsesNonExemptEncryption` is `false` in
  the current native project.
- iPhone and iPad screenshots match the submitted build.
- Reviewer credentials and review notes are complete.
- Version is configured for manual release after approval.

### Google Play

- Developer account is an organization account with verified legal and contact
  information.
- Store listing, contact details, privacy policy, and account-deletion URL are
  complete.
- App Access contains reusable reviewer credentials.
- Data Safety, content rating, target audience, ads, and user-generated-content
  declarations are complete.
- The release AAB is signed through Play App Signing and targets API 36.
- `google-services.json` is present for the release build and production FCM
  delivery is verified on a physical Android device.
- Internal testing and the physical-device matrix are complete.
- Production availability is limited to the intended first-release territory.

## Go/no-go gate

Submit neither production listing until all P0 items in
`docs/wip/mobile-release-readiness-2026-08-17.md` are closed, the reviewer
account works on fresh devices, and the privacy/data-safety answers have been
reviewed against the release build.
