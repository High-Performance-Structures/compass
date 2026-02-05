"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { IconLoader } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/auth/password-input"
import { loginSchema, type LoginInput } from "@/lib/validations/auth"

export function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [isLoading, setIsLoading] = React.useState(false)
    
    // get the return URL from query params (set by middleware)
    const returnTo = searchParams.get("from") || "/dashboard"

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginInput>({
        resolver: zodResolver(loginSchema),
    })

    const onSubmit = async (data: LoginInput) => {
        setIsLoading(true)

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: "password",
                    email: data.email,
                    password: data.password,
                }),
            })

            const result = (await response.json()) as {
                success: boolean
                message?: string
                error?: string
                redirectUrl?: string
            }

            if (result.success) {
                toast.success("Welcome back!")
                router.push(returnTo)
            } else {
                toast.error(result.error || "Login failed")
            }
        } catch {
            toast.error("An error occurred. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="h-9 text-base"
                    {...register("email")}
                />
                {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                        href="/reset-password"
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                        Forgot password?
                    </Link>
                </div>
                <PasswordInput
                    id="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-9 text-base"
                    {...register("password")}
                />
                {errors.password && (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
            </div>

            <Button type="submit" disabled={isLoading} className="h-10 w-full">
                {isLoading ? (
                    <>
                        <IconLoader className="mr-2 size-4 animate-spin" />
                        Signing in...
                    </>
                ) : (
                    "Sign in"
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
