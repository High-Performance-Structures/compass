"use client"

import type * as React from "react"
import type { UseFormRegisterReturn } from "react-hook-form"

import { PasswordInput } from "@/components/auth/password-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/*
 * The name and password inputs the sign-up, invitation and set-password
 * forms share. Each form registers its own fields (react-hook-form) and
 * passes the registration and any error message in; the rules live in
 * src/lib/validations/auth.ts.
 */

function FieldError({ message }: { readonly message: string | undefined }): React.ReactElement | null {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

/** First and last name, side by side on wider screens. */
export function NameFields({
  firstName,
  lastName,
  firstNameError,
  lastNameError,
}: {
  readonly firstName: UseFormRegisterReturn
  readonly lastName: UseFormRegisterReturn
  readonly firstNameError?: string
  readonly lastNameError?: string
}): React.ReactElement {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="firstName">First name</Label>
        <Input id="firstName" type="text" placeholder="John" autoComplete="given-name" className="h-9 text-base" {...firstName} />
        <FieldError message={firstNameError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastName">Last name</Label>
        <Input id="lastName" type="text" placeholder="Doe" autoComplete="family-name" className="h-9 text-base" {...lastName} />
        <FieldError message={lastNameError} />
      </div>
    </div>
  )
}

/** A new password and the box to type it again. */
export function NewPasswordFields({
  password,
  confirmPassword,
  passwordError,
  confirmPasswordError,
  passwordLabel = "Password",
}: {
  readonly password: UseFormRegisterReturn
  readonly confirmPassword: UseFormRegisterReturn
  readonly passwordError?: string
  readonly confirmPasswordError?: string
  /** "New password" on the reset form. */
  readonly passwordLabel?: string
}): React.ReactElement {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="password">{passwordLabel}</Label>
        <PasswordInput id="password" placeholder="••••••••" autoComplete="new-password" className="h-9 text-base" {...password} />
        <FieldError message={passwordError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <PasswordInput
          id="confirmPassword"
          placeholder="••••••••"
          autoComplete="new-password"
          className="h-9 text-base"
          {...confirmPassword}
        />
        <FieldError message={confirmPasswordError} />
      </div>
    </>
  )
}
