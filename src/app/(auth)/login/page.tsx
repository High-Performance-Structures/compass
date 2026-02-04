"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoginForm } from "@/components/auth/login-form";
import { PasswordlessForm } from "@/components/auth/passwordless-form";

export default function LoginPage() {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted-foreground">
          Sign in to your account
        </p>
      </div>

      <Tabs defaultValue="password" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="passwordless">Send Code</TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="mt-4">
          <LoginForm />
        </TabsContent>

        <TabsContent value="passwordless" className="mt-4">
          <PasswordlessForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
