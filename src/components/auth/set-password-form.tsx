"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { IconLoader } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { } from "@/components/ui/label";
import { NewPasswordFields } from "@/components/auth/new-account-fields";
import { setPasswordSchema, type SetPasswordInput } from "@/lib/validations/auth";

interface SetPasswordFormProps {
  token: string;
}

export function SetPasswordForm({ token }: SetPasswordFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema)
  });

  const onSubmit = async (data: SetPasswordInput) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: data.password
        })
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
        toast.error(result.error || "Password reset failed");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <NewPasswordFields
        password={register("password")}
        confirmPassword={register("confirmPassword")}
        passwordError={errors.password?.message}
        confirmPasswordError={errors.confirmPassword?.message}
        passwordLabel="New password"
      />

      <Button type="submit" disabled={isLoading} className="h-10 w-full">
        {isLoading ? (
          <>
            <IconLoader className="mr-2 size-4 animate-spin" />
            Resetting password...
          </>
        ) : (
          "Reset password"
        )}
      </Button>
    </form>
  );
}
