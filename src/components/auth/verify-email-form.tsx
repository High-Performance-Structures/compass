"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { IconLoader } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const codeSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
});

type CodeFormData = z.infer<typeof codeSchema>;

export function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const userId = searchParams.get("userId") || "";
  const [isLoading, setIsLoading] = React.useState(false);

  const {
    watch,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<CodeFormData>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = async (data: CodeFormData) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: data.code,
          userId,
        }),
      });

      const result = (await response.json()) as {
        success: boolean;
        message?: string;
        error?: string;
        [key: string]: unknown;
      };

      if (result.success) {
        toast.success(result.message);
        router.push("/login");
      } else {
        toast.error(result.error || "Verification failed");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    setValue("code", value);
    if (value.length === 6) {
      handleSubmit(onSubmit)();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>Enter 6-digit code</Label>
        <p className="text-xs text-muted-foreground">
          We sent a verification code to{" "}
          <strong>{email || "your email"}</strong>
        </p>
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={watch("code") || ""}
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
        {errors.code && (
          <p className="text-xs text-destructive text-center">
            {errors.code.message}
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
          "Verify email"
        )}
      </Button>
    </form>
  );
}
