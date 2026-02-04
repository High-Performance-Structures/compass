import { InviteForm } from "@/components/auth/invite-form";

interface InvitePageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          You&apos;ve been invited
        </h2>
        <p className="text-sm text-muted-foreground">
          Set up your account to get started
        </p>
      </div>

      <InviteForm token={token} />
    </div>
  );
}
