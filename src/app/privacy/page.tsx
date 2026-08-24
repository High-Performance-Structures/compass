import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Compass",
  description: "How Compass collects, uses, protects, and deletes information.",
};

const GOOGLE_PRIVACY_POLICY = "https://policies.google.com/privacy";
const GOOGLE_PERMISSIONS = "https://myaccount.google.com/permissions";
const GOOGLE_API_DATA_POLICY =
  "https://developers.google.com/terms/api-services-user-data-policy";

export default function PrivacyPolicyPage(): React.ReactElement {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <article className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <Link href="/" className="text-primary text-sm font-medium">
          ← Compass
        </Link>
        <p className="text-muted-foreground mt-10 text-sm">
          Effective August 7, 2026
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground mt-4 leading-7">
          Compass is a construction project-management service operated by High
          Performance Structures Inc. dba Open Range Construction, Ltd. for its
          operating departments, including Open Range Construction, Ltd., High
          Performance Structures, Nu-Tech, and Design. This policy explains how
          Compass handles information when staff, owners, subcontractors,
          suppliers, and invited project participants use the service.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            Information Compass processes
          </h2>
          <p className="leading-7">
            Compass processes account and contact information, project records,
            schedules, messages, files, photos, videos, financial workflow
            records, activity history, device and security information, and
            information users intentionally submit to project workspaces. Access
            is limited by role, organization, project membership, and configured
            project visibility.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            Google and YouTube information
          </h2>
          <p className="leading-7">
            Authorized internal administrators may connect company-managed
            Google and YouTube accounts. Compass requests only the OAuth scopes
            displayed on Google&apos;s consent screen. For YouTube, Compass uses
            authorization to identify the selected company channel and upload
            user-selected project videos with their title, description,
            audience, and visibility choices.
          </p>
          <p className="leading-7">
            Compass stores the connected Google account email, YouTube channel
            ID and title, granted scopes, connection timestamps, and an
            encrypted OAuth refresh token. Tokens are used server-side and are
            not exposed to project participants. Compass does not sell Google
            user data or use it for advertising, credit, or unrelated profiling.
          </p>
          <p className="leading-7">
            Compass&apos;s use and transfer of information received from Google
            APIs complies with the Google API Services User Data Policy,
            including its Limited Use requirements. Review Google&apos;s own
            practices in the{" "}
            <a
              className="text-primary underline underline-offset-4"
              href={GOOGLE_PRIVACY_POLICY}
              target="_blank"
              rel="noreferrer"
            >
              Google Privacy Policy
            </a>{" "}
            and the{" "}
            <a
              className="text-primary underline underline-offset-4"
              href={GOOGLE_API_DATA_POLICY}
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            .
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">How information is used</h2>
          <p className="leading-7">
            Information is used to provide project collaboration, scheduling,
            communications, file and media workflows, requested integrations,
            notifications, security, auditing, support, and service improvement.
            Compass does not use YouTube API data to create independent
            advertising profiles or to recreate YouTube&apos;s service.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Sharing and visibility</h2>
          <p className="leading-7">
            Project information is shared only with authorized organization
            members, invited project participants, service providers needed to
            operate Compass, and integrations a permitted administrator enables.
            YouTube videos may be private, unlisted, or public as shown before
            publication. An unlisted YouTube link can be viewed and forwarded by
            anyone who obtains the link, even when Compass distributes it only
            to authorized users.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            Retention, deletion, and revocation
          </h2>
          <p className="leading-7">
            Compass retains project information according to business,
            contractual, legal, and backup requirements. Google OAuth tokens and
            connected-channel metadata are retained only while the connection is
            active or as required for security records. An authorized
            administrator can disconnect a YouTube channel from the
            project-video workspace. Compass then removes the stored connection
            and attempts to revoke the Google token.
          </p>
          <p className="leading-7">
            A Google user may also revoke Compass directly from{" "}
            <a
              className="text-primary underline underline-offset-4"
              href={GOOGLE_PERMISSIONS}
              target="_blank"
              rel="noreferrer"
            >
              Google Account permissions
            </a>
            . Users may request deletion or correction through their Compass
            administrator. Removing a Compass connection does not automatically
            delete videos already published to a company YouTube channel; a
            channel manager can remove those videos in YouTube Studio or request
            assistance.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Security</h2>
          <p className="leading-7">
            Compass uses authentication, authorization checks, encrypted
            integration credentials, server-side token handling, activity
            records, and access controls designed to protect project and
            integration data. No system can guarantee absolute security, so
            suspected misuse should be reported promptly.
          </p>
        </section>

        <section className="mt-10 space-y-4 border-t pt-8">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="leading-7">
            Privacy, access, correction, and deletion requests may be sent to{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="mailto:martine@openrangeconstruction.com"
            >
              martine@openrangeconstruction.com
            </a>
            .
          </p>
          <p className="text-muted-foreground text-sm">
            High Performance Structures Inc. dba Open Range Construction, Ltd.
            <br />
            660 Chipmunk Dr., Woodland Park, CO 80863
          </p>
        </section>
      </article>
    </main>
  );
}
