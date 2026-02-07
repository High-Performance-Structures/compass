"use client"

import { cn } from "@/lib/utils"

// provider logo files in /public/providers/
export const PROVIDER_LOGO: Record<string, string> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
  Meta: "meta",
  Mistral: "mistral",
  DeepSeek: "deepseek",
  xAI: "xai",
  NVIDIA: "nvidia",
  Microsoft: "microsoft",
  Amazon: "amazon",
  Perplexity: "perplexity",
}

const PROVIDER_ABBR: Record<string, string> = {
  "Alibaba (Qwen)": "Qw",
  Cohere: "Co",
  Moonshot: "Ms",
}

function getProviderAbbr(name: string): string {
  return (
    PROVIDER_ABBR[name] ??
    name.slice(0, 2).toUpperCase()
  )
}

export function hasLogo(provider: string): boolean {
  return provider in PROVIDER_LOGO
}

export function ProviderIcon({
  provider,
  size = 24,
  className,
}: {
  readonly provider: string
  readonly size?: number
  readonly className?: string
}): React.JSX.Element {
  const logo = PROVIDER_LOGO[provider]

  if (logo) {
    return (
      <img
        src={`/providers/${logo}.svg`}
        alt={provider}
        width={size}
        height={size}
        className={cn(
          "object-contain",
          className
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-muted/80 text-muted-foreground font-medium tracking-tight",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.35),
      }}
    >
      {getProviderAbbr(provider)}
    </span>
  )
}
