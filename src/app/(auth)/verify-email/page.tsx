import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

function VerifyEmailContent() {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Verify your email
        </h2>
        <p className="text-sm text-muted-foreground">
          Enter the code we sent to your email
        </p>
      </div>

      <VerifyEmailForm />
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
