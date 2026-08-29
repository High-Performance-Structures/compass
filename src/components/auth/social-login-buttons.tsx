"use client"

import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  IconBrandGoogle,
  IconBrandWindows,
  IconBrandGithub,
  IconBrandApple,
} from "@tabler/icons-react"
import { getNativeMobilePlatform } from "@/lib/native/platform"

const providers = [
  { id: "GoogleOAuth", label: "Google", icon: IconBrandGoogle },
  {
    id: "MicrosoftOAuth",
    label: "Microsoft",
    icon: IconBrandWindows,
  },
  { id: "GitHubOAuth", label: "GitHub", icon: IconBrandGithub },
  { id: "AppleOAuth", label: "Apple", icon: IconBrandApple },
] as const

export function SocialLoginButtons() {
  const searchParams = useSearchParams()
  const from = searchParams.get("from")
  const isIosApp = getNativeMobilePlatform() === "ios"
  const availableProviders = isIosApp
    ? providers.filter(({ id }) => id !== "GoogleOAuth")
    : providers

  const handleSSOLogin = (provider: string) => {
    const params = new URLSearchParams({ provider })
    if (from) params.set("from", from)
    window.location.href = `/api/auth/sso?${params}`
  }

  return (
    <div className="space-y-2">
      {isIosApp && (
        <p className="text-sm text-muted-foreground">
          Google sign-in is not available inside the iPhone app. Continue
          with email below.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {availableProviders.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="outline"
            className="h-10"
            onClick={() => handleSSOLogin(id)}
          >
            <Icon className="mr-2 size-4" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
