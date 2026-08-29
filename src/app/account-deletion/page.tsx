import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Delete Your Compass Account",
  description:
    "How to request deletion of a Compass account and associated personal data.",
}

const DELETION_EMAIL =
  "mailto:martine@openrangeconstruction.com?subject=Compass%20account%20deletion%20request"

export default function AccountDeletionPage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <Link href="/" className="text-primary text-sm font-medium">
          ← Compass
        </Link>

        <h1 className="mt-10 text-3xl font-semibold tracking-tight">
          Delete your Compass account
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          You can request permanent deletion from Compass on the web or in the
          iOS and Android apps. Requests are reviewed and completed within 30
          days.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Request deletion in Compass</h2>
          <ol className="list-decimal space-y-2 pl-5 leading-7">
            <li>
              <Link
                href="/login"
                className="text-primary underline underline-offset-4"
              >
                Sign in to Compass
              </Link>
              .
            </li>
            <li>
              Open the{" "}
              <Link
                href="/dashboard/account"
                className="text-primary underline underline-offset-4"
              >
                Account page
              </Link>
              . In Field Mode, open Settings and select Manage account.
            </li>
            <li>Under Delete Account, select Request account deletion.</li>
            <li>Type DELETE and submit the request.</li>
          </ol>
          <p className="leading-7 text-muted-foreground">
            You may cancel a pending request from the same Account screen until
            processing begins.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">If you cannot sign in</h2>
          <p className="leading-7">
            Email a deletion request from the address associated with your
            Compass account. We will verify account ownership before processing
            it.
          </p>
          <a
            href={DELETION_EMAIL}
            className="text-primary underline underline-offset-4"
          >
            Email a deletion request
          </a>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">What deletion covers</h2>
          <p className="leading-7">
            Compass deletes the authentication identity, profile, device tokens,
            notification preferences, personal workspace, and other personal
            data that is not subject to a retention requirement.
          </p>
          <p className="leading-7">
            Construction project, financial, contract, security, and audit
            records may need to be retained for the organization that owns those
            records or to meet legal obligations. Where practical, retained
            records are detached from the deleted identity or de-identified.
          </p>
        </section>

        <section className="mt-10 border-t pt-8">
          <p className="text-sm text-muted-foreground">
            High Performance Structures Inc. dba Open Range Construction, Ltd.
            <br />
            660 Chipmunk Dr., Woodland Park, CO 80863
          </p>
        </section>
      </article>
    </main>
  )
}
