"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { audienceScopeFromUrl, scopedAudienceHref, type ProjectAudienceRequestScope } from "@/lib/project-audience-request"

const ScopeContext = React.createContext<(href: string) => string>((href) => href)

export function useAudiencePreviewHref(): (href: string) => string {
  return React.useContext(ScopeContext)
}

export function ProjectAudiencePreviewScope({ children, readOnly = false, canonicalScope }: { readonly children: React.ReactNode; readonly readOnly?: boolean; readonly canonicalScope?: ProjectAudienceRequestScope }): React.ReactElement {
  const pathname = usePathname()
  const params = useSearchParams()
  const scope = readOnly ? canonicalScope ?? audienceScopeFromUrl(new URL(`${pathname}?${params}`, "https://compass.invalid")) : null
  const scopedHref = (href: string): string => scope ? scopedAudienceHref(href, scope) : href
  return <ScopeContext.Provider value={scopedHref}><div className="contents" onClickCapture={(event) => {
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest("a")
    if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return
    const href = `${anchor.pathname}${anchor.search}${anchor.hash}`
    const next = scopedHref(href)
    if (!readOnly) return
    anchor.href = next
    // Next Link reads its props rather than the DOM href. Intercept navigation
    // so the selected viewer survives links authored by shared components.
    if (anchor.pathname.startsWith("/preview/") && !anchor.download && !anchor.target && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      window.location.assign(next)
    }
  }}>{children}</div></ScopeContext.Provider>
}
