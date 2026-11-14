"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { audienceScopeFromUrl, scopedAudienceHref, type ProjectAudienceRequestScope } from "@/lib/project-audience-request"

const ScopeContext = React.createContext<(href: string) => string>((href) => href)
const ReadOnlyContext = React.createContext(false)

export function useAudiencePreviewReadOnly(): boolean {
  return React.useContext(ReadOnlyContext)
}

export function useAudiencePreviewHref(): (href: string) => string {
  return React.useContext(ScopeContext)
}

export function ProjectAudiencePreviewScope({ children, readOnly = false, canonicalScope }: { readonly children: React.ReactNode; readonly readOnly?: boolean; readonly canonicalScope?: ProjectAudienceRequestScope }): React.ReactElement {
  const pathname = usePathname()
  const params = useSearchParams()
  const scope = readOnly ? canonicalScope ?? audienceScopeFromUrl(new URL(`${pathname}?${params}`, "https://compass.invalid")) : null
  const scopedHref = React.useCallback((href: string): string => scope ? scopedAudienceHref(href, scope) : href, [scope])
  const container = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!readOnly || !container.current) return
    const scopeLinks = (): void => {
      for (const anchor of container.current?.querySelectorAll("a") ?? []) {
        if (anchor.origin !== window.location.origin) continue
        const current = `${anchor.pathname}${anchor.search}${anchor.hash}`
        const next = scopedHref(current)
        if (next !== current) anchor.href = next
      }
    }
    scopeLinks()
    const observer = new MutationObserver(scopeLinks)
    observer.observe(container.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] })
    return () => observer.disconnect()
  }, [readOnly, scopedHref])
  return <ReadOnlyContext.Provider value={readOnly}><ScopeContext.Provider value={scopedHref}><div ref={container} className="contents" onClickCapture={(event) => {
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest("a")
    if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return
    const href = `${anchor.pathname}${anchor.search}${anchor.hash}`
    const next = scopedHref(href)
    if (!readOnly) return
    anchor.href = next
    // Next Link reads its props rather than the DOM href. Intercept navigation
    // so the selected viewer survives links authored by shared components.
    if (event.button === 0 && anchor.pathname.startsWith("/preview/") && !anchor.download && !anchor.target && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      window.location.assign(next)
    }
  }}>{children}</div></ScopeContext.Provider></ReadOnlyContext.Provider>
}

/**
 * Shows a control exactly as the previewed person sees it, but unusable, with a
 * note saying so. Outside a staff preview it renders the children unchanged.
 * The server refuses preview writes regardless; this keeps staff from trying.
 */
export function PreviewReadOnlyArea({ note, onClose, children }: { readonly note: string; readonly onClose?: () => void; readonly children: React.ReactNode }): React.ReactElement {
  const readOnly = useAudiencePreviewReadOnly()
  if (!readOnly) return <>{children}</>
  return <>
    <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {note}
      {/* A whole form is unusable in preview, so its own Back button is too; keep a way out. */}
      {onClose && <button type="button" className="underline hover:text-foreground" onClick={onClose}>Close</button>}
    </p>
    <div inert className="opacity-60">{children}</div>
  </>
}
