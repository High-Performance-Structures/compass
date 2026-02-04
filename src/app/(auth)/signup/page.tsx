import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h2>
        <p className="text-sm text-muted-foreground">
          Get started with Compass
        </p>
      </div>

      <SignupForm />
    </div>
  );
}
