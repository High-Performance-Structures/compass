import { SetPasswordForm } from "@/components/auth/set-password-form";

interface ResetPasswordTokenPageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function ResetPasswordTokenPage({
  params,
}: ResetPasswordTokenPageProps) {
  const { token } = await params;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Set new password
        </h2>
        <p className="text-sm text-muted-foreground">
          Enter your new password below
        </p>
      </div>

      <SetPasswordForm token={token} />
    </div>
  );
}
