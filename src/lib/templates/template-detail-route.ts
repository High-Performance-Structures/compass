const TEMPLATE_DETAIL_ALIAS = "open"

export function templateDetailHref(templateId: string): string {
  const query = new URLSearchParams({ templateId })
  return `/dashboard/templates/${TEMPLATE_DETAIL_ALIAS}?${query.toString()}`
}

export function resolveTemplateDetailId(
  routeId: string,
  queryTemplateId: string | readonly string[] | undefined
): string | null {
  if (routeId !== TEMPLATE_DETAIL_ALIAS) return routeId
  if (typeof queryTemplateId !== "string") return null

  const normalized = queryTemplateId.trim()
  return normalized.length > 0 ? normalized : null
}
