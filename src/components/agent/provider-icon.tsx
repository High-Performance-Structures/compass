"use client"

import { cn } from "@/lib/utils"

// Inline SVG for Claude sparkle — avoids static file caching issues
function ClaudeIcon({ size, className }: { size: number; className?: string }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M12 2a.9.9 0 0 1 .84.58l2.32 5.94a4.5 4.5 0 0 0 2.6 2.6l5.94 2.32a.9.9 0 0 1 0 1.67l-5.94 2.32a4.5 4.5 0 0 0-2.6 2.6l-2.32 5.94a.9.9 0 0 1-1.68 0l-2.32-5.94a4.5 4.5 0 0 0-2.6-2.6L.3 15.11a.9.9 0 0 1 0-1.67l5.94-2.32a4.5 4.5 0 0 0 2.6-2.6L11.16 2.58A.9.9 0 0 1 12 2Z"
        fill="#D97757"
      />
    </svg>
  )
}

// providers with inline SVG components (preferred) or file-based logos
const INLINE_ICONS: Record<string, (size: number, className?: string) => React.JSX.Element> = {
  Anthropic: (size, className) => <ClaudeIcon size={size} className={className} />,
}

// provider logo files in /public/providers/
export const PROVIDER_LOGO: Record<string, string> = {
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
  Ollama: "ollama",
  OpenRouter: "openai",
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
  return provider in PROVIDER_LOGO || provider in INLINE_ICONS
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
  // Prefer inline SVG components
  const inlineIcon = INLINE_ICONS[provider]
  if (inlineIcon) {
    return inlineIcon(size, className)
  }

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
