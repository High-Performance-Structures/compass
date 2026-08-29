import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Compass Community Guidelines",
  description: "Safety and conduct standards for Compass conversations.",
}

export default function CommunityGuidelinesPage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <Link href="/" className="text-primary text-sm font-medium">
          ← Compass
        </Link>
        <h1 className="mt-10 text-3xl font-semibold tracking-tight">
          Community guidelines
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Compass conversations are shared workspaces for verified project
          participants. Treat coworkers, customers, vendors, and partners with
          respect.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Not allowed</h2>
          <ul className="list-disc space-y-2 pl-5 leading-7">
            <li>Harassment, threats, hate speech, bullying, or sexual content.</li>
            <li>Spam, impersonation, fraud, or deceptive links.</li>
            <li>
              Sharing private personal, customer, employee, or project
              information without authorization.
            </li>
            <li>Illegal content or instructions that create an immediate safety risk.</li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Reporting and enforcement</h2>
          <p className="leading-7">
            Use the Report action on a conversation message to send it to a
            Compass administrator. Administrators can remove messages, restrict
            channel access, deactivate abusive accounts, and escalate urgent
            safety concerns. Reports are reviewed promptly and are visible only
            to authorized reviewers.
          </p>
          <p className="leading-7">
            For urgent help, email{" "}
            <a
              href="mailto:martine@openrangeconstruction.com?subject=Compass%20safety%20report"
              className="text-primary underline underline-offset-4"
            >
              Compass support
            </a>
            . If someone may be in immediate danger, contact local emergency
            services first.
          </p>
        </section>

        <section className="mt-10 border-t pt-8 text-sm text-muted-foreground">
          <p>
            Also review the{" "}
            <Link href="/terms" className="text-primary underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </article>
    </main>
  )
}
