import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Reset password
        </h2>
        <p className="text-sm text-muted-foreground">
          Enter your email to receive a reset link
        </p>
      </div>

      <ResetPasswordForm />
    </div>
  );
}
