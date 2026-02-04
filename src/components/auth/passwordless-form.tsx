"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { IconLoader } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const emailSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

const codeSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
});

type EmailFormData = z.infer<typeof emailSchema>;
type CodeFormData = z.infer<typeof codeSchema>;

export function PasswordlessForm() {
  const router = useRouter();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);

  const emailForm = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
  });

  const codeForm = useForm<CodeFormData>({
    resolver: zodResolver(codeSchema),
  });

  const onSendCode = async (data: EmailFormData) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "passwordless_send",
          email: data.email,
        }),
      });

      const result = (await response.json()) as {
        success: boolean;
        message?: string;
        error?: string;
        [key: string]: unknown;
      };

      if (result.success) {
        setEmail(data.email);
        setStep("code");
        toast.success("Check your email for a 6-digit code");
      } else {
        toast.error(result.error || "Failed to send code");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onVerifyCode = async (data: CodeFormData) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "passwordless_verify",
          email,
          code: data.code,
        }),
      });

      const result = (await response.json()) as {
        success: boolean;
        message?: string;
        error?: string;
        redirectUrl?: string;
        [key: string]: unknown;
      };

      if (result.success) {
        toast.success("Welcome back!");
        router.push(result.redirectUrl as string);
      } else {
        toast.error(result.error || "Invalid code");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    codeForm.setValue("code", value);
    if (value.length === 6) {
      codeForm.handleSubmit(onVerifyCode)();
    }
  };

  if (step === "email") {
    return (
      <form onSubmit={emailForm.handleSubmit(onSendCode)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            className="h-9 text-base"
            {...emailForm.register("email")}
          />
          {emailForm.formState.errors.email && (
            <p className="text-xs text-destructive">
              {emailForm.formState.errors.email.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isLoading} className="h-10 w-full">
          {isLoading ? (
            <>
              <IconLoader className="mr-2 size-4 animate-spin" />
              Sending code...
            </>
          ) : (
            "Send code"
          )}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
      <div className="space-y-2">
        <Label>Enter 6-digit code</Label>
        <p className="text-xs text-muted-foreground">
          We sent a code to <strong>{email}</strong>
        </p>
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={codeForm.watch("code") || ""}
            onChange={handleCodeChange}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        {codeForm.formState.errors.code && (
          <p className="text-xs text-destructive text-center">
            {codeForm.formState.errors.code.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isLoading} className="h-10 w-full">
        {isLoading ? (
          <>
            <IconLoader className="mr-2 size-4 animate-spin" />
            Verifying...
          </>
        ) : (
          "Verify code"
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => setStep("email")}
      >
        Use a different email
      </Button>
    </form>
  );
}
