import { z } from "zod/v4"

import type { ProjectDepartment } from "../src/lib/project-branding"

// Compass owns the Field Mode frame; the company a project belongs to shows
// inside it. Company names and uploaded logos come from the organization's
// Department Profiles (Settings → Company) and are cached for offline use.

const fieldCompanySchema = z.object({
  displayName: z.string(),
  shortName: z.string(),
  logoDataUrl: z.string(),
})
export type FieldCompany = z.infer<typeof fieldCompanySchema>

export const fieldCompaniesSchema = z.record(z.string(), fieldCompanySchema)
export type FieldCompanies = z.infer<typeof fieldCompaniesSchema>

// Bundled with the app so company marks render offline before a custom logo
// has ever been downloaded.
const BUNDLED_LOGOS: Readonly<Record<ProjectDepartment, string>> = {
  O: "./department-logos/orc-mark.png",
  H: "./department-logos/hps-h-green.svg",
  N: "./department-logos/nu-tech-n.png",
  D: "./department-logos/orc-mark.png",
}

export function companyLogoSrc(department: ProjectDepartment, company: FieldCompany | undefined): string {
  return company?.logoDataUrl.startsWith("data:image/") ? company.logoDataUrl : BUNDLED_LOGOS[department]
}

/** The Compass mark from the web sidebar: a ring with the needle in the accent color. */
export function compassMarkSvg(className = "compass-mark-svg"): string {
  return `<svg class="${className}" viewBox="0 0 30 30" fill="none" aria-hidden="true"><circle cx="15" cy="15" r="13" stroke="currentColor" stroke-width="1.6"></circle><path class="compass-needle" d="M19.5 10.5L16.6 16.6 10.5 19.5 13.4 13.4z" stroke-width="1"></path><circle class="compass-hub" cx="15" cy="15" r="1.4"></circle></svg>`
}

const ICON_PATHS = {
  projects: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>`,
  today: `<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path><path d="m9 15 2 2 4-4"></path>`,
  log: `<rect x="6" y="4" width="12" height="17" rx="2"></rect><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"></path>`,
  machines: `<path d="M2 18h12M4 18v-5h6l2.5 5"></path><circle cx="5.5" cy="19.5" r="1.5"></circle><circle cx="11" cy="19.5" r="1.5"></circle><path d="M12 13l4-7 5 3-2.5 3.5"></path><path d="M18.5 12.5 21 15h-3"></path>`,
  documents: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 13h6M9 17h6"></path>`,
  chat: `<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"></path>`,
  cherish: `<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path>`,
  settings: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle>`,
  external: `<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>`,
  switch: `<path d="m7 15 5 5 5-5M7 9l5-5 5 5"></path>`,
  chevron: `<path d="m9 6 6 6-6 6"></path>`,
} as const

export type FieldIcon = keyof typeof ICON_PATHS

export function fieldIcon(name: FieldIcon, className = "field-icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
}
