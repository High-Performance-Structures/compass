"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { IconLoader } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { } from "@/components/ui/input";
import { } from "@/components/ui/label";
import { NameFields, NewPasswordFields } from "@/components/auth/new-account-fields";
import { acceptInviteSchema, type AcceptInviteInput } from "@/lib/validations/auth";

interface InviteFormProps {
  token: string;
}

export function InviteForm({ token }: InviteFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema)
  });

  const onSubmit = async (data: AcceptInviteInput) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitationToken: token,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName
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
        toast.error(result.error || "Invitation acceptance failed");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <NameFields
        firstName={register("firstName")}
        lastName={register("lastName")}
        firstNameError={errors.firstName?.message}
        lastNameError={errors.lastName?.message}
      />

      <NewPasswordFields
        password={register("password")}
        confirmPassword={register("confirmPassword")}
        passwordError={errors.password?.message}
        confirmPasswordError={errors.confirmPassword?.message}
      />

      <Button type="submit" disabled={isLoading} className="h-10 w-full">
        {isLoading ? (
          <>
            <IconLoader className="mr-2 size-4 animate-spin" />
            Accepting invitation...
          </>
        ) : (
          "Accept invitation"
        )}
      </Button>
    </form>
  );
}
