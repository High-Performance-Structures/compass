import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Compass",
  description: "Terms governing authorized use of Compass.",
};

export default function TermsPage(): React.ReactElement {
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
          Terms of Service
        </h1>
        <p className="text-muted-foreground mt-4 leading-7">
          These terms govern authorized use of Compass, a construction
          project-management service operated by High Performance Structures
          Inc. dba Open Range Construction, Ltd. for its operating departments,
          including Open Range Construction, Ltd., High Performance Structures,
          Nu-Tech, and Design.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Authorized access</h2>
          <p className="leading-7">
            Users may access only the organization, projects, records, and
            functions made available to their account. Users must protect their
            credentials, provide accurate information, and promptly report
            unauthorized access. Access may be suspended or removed when a
            project relationship ends or when necessary to protect Compass,
            project participants, or company data.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Project content</h2>
          <p className="leading-7">
            Users retain their rights in content they submit. By submitting
            content, a user authorizes Compass and its connected service
            providers to store, process, reproduce, transmit, display, and
            publish that content only as necessary to provide the selected
            project workflow and audience.
          </p>
          <p className="leading-7">
            Users must have permission to submit project files, photos, videos,
            personal information, and third-party materials. Users may not
            submit unlawful, infringing, deceptive, unsafe, malicious, or
            confidential information outside the project audience authorized to
            receive it.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">YouTube publishing</h2>
          <p className="leading-7">
            Authorized staff may connect company-managed YouTube channels and
            publish selected project videos. Before publishing, users must
            choose the intended audience and confirm public publication when
            applicable. Users certify that uploaded videos comply with the{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
            >
              YouTube Terms of Service
            </a>{" "}
            and{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="https://www.youtube.com/howyoutubeworks/policies/community-guidelines/"
              target="_blank"
              rel="noreferrer"
            >
              Community Guidelines
            </a>
            .
          </p>
          <p className="leading-7">
            Private videos are limited by YouTube&apos;s account controls.
            Unlisted videos do not appear in normal public discovery, but anyone
            who obtains the URL may view or forward it. Public videos are
            visible through YouTube. Compass does not guarantee that a recipient
            will keep an unlisted URL confidential.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Service and integrations</h2>
          <p className="leading-7">
            Third-party integrations remain subject to their providers&apos;
            terms, availability, permissions, and technical limits. Compass may
            update, suspend, or discontinue an integration when required for
            security, compliance, reliability, or provider changes.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Responsible use</h2>
          <p className="leading-7">
            Users may not bypass permissions, probe for unauthorized data,
            interfere with service operation, impersonate another person, upload
            malware, or use Compass to violate law, contractual duties,
            intellectual-property rights, privacy rights, or third-party
            platform rules.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Records and decisions</h2>
          <p className="leading-7">
            Compass supports project communication and workflow but does not
            replace signed contracts, professional judgment, legal advice,
            engineering review, safety obligations, or accounting controls.
            Users remain responsible for reviewing information before relying on
            it for a project decision.
          </p>
        </section>

        <section className="mt-10 space-y-4 border-t pt-8">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="leading-7">
            Questions about these terms may be sent to{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="mailto:martine@openrangeconstruction.com"
            >
              martine@openrangeconstruction.com
            </a>
            . Review the{" "}
            <Link className="text-primary underline" href="/privacy">
              Privacy Policy
            </Link>{" "}
            for information about data use, revocation, and deletion.
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
