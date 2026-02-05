"use client"

import { Suspense } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LoginForm } from "@/components/auth/login-form"
import { PasswordlessForm } from "@/components/auth/passwordless-form"
import { SocialLoginButtons } from "@/components/auth/social-login-buttons"
import { Separator } from "@/components/ui/separator"

function LoginContent() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome back
        </h2>
        <p className="text-sm text-muted-foreground">
          Sign in to your account
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
            or continue with
          </span>
        </div>
      </div>

      <Tabs defaultValue="password" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="passwordless">
            Send Code
          </TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="mt-4">
          <LoginForm />
        </TabsContent>

        <TabsContent value="passwordless" className="mt-4">
          <PasswordlessForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="space-y-2 animate-pulse">Loading...</div>}>
      <LoginContent />
    </Suspense>
  )
}
