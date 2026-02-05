"use client"

import { Suspense } from "react"
import { SignupForm } from "@/components/auth/signup-form"
import { SocialLoginButtons } from "@/components/auth/social-login-buttons"
import { Separator } from "@/components/ui/separator"

export default function SignupPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h2>
        <p className="text-sm text-muted-foreground">
          Get started with Compass
        </p>
      </div>

      <Suspense>
        <SocialLoginButtons />
      </Suspense>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator className="w-full" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">
            or continue with email
          </span>
        </div>
      </div>

      <SignupForm />
    </div>
  )
}
