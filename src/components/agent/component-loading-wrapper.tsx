import { type ReactNode, useMemo } from "react"
import { PropSkeleton, type PropSkeletonType } from "./prop-skeleton"

export interface PropConfig {
  readonly name: string
  readonly type: PropSkeletonType
  readonly required?: boolean
  readonly fallback?: ReactNode
}

interface ComponentLoadingWrapperProps {
  readonly props: Record<string, unknown>
  readonly propConfigs: PropConfig[]
  readonly children: ReactNode
  readonly loading?: boolean
  readonly showSkeletonsForMissing?: boolean
}

// Maps prop types to skeleton renderers
function renderSkeleton(type: PropSkeletonType): ReactNode {
  return <PropSkeleton type={type} />
}

// Wraps components and shows skeletons for props that haven't arrived yet
export function ComponentLoadingWrapper({
  props,
  propConfigs,
  children,
  loading,
  showSkeletonsForMissing = true,
}: ComponentLoadingWrapperProps): ReactNode {
  const { hasAllRequired, missingProps } = useMemo(() => {
    const missing: Array<{ name: string; type: PropSkeletonType }> = []
    let hasAll = true

    for (const config of propConfigs) {
      const value = props[config.name]
      const hasValue =
        value !== undefined && value !== null && value !== ""

      if (!hasValue) {
        if (config.required !== false) {
          hasAll = false
        }
        if (showSkeletonsForMissing) {
          missing.push({ name: config.name, type: config.type })
        }
      }
    }

    return { hasAllRequired: hasAll, missingProps: missing }
  }, [props, propConfigs, showSkeletonsForMissing])

  // If component is in global loading state, show full skeleton
  if (loading) {
    return (
      <div className="space-y-2">
        {propConfigs.map((config) => (
          <div key={config.name}>{renderSkeleton(config.type)}</div>
        ))}
      </div>
    )
  }

  // If missing required props, show skeleton placeholders
  if (!hasAllRequired && showSkeletonsForMissing) {
    return (
      <div className="space-y-2">
        {propConfigs.map((config) => {
          const value = props[config.name]
          const hasValue =
            value !== undefined && value !== null && value !== ""

          if (hasValue) {
            // Show the actual value if present (partial rendering)
            return <div key={config.name}>{String(value)}</div>
          }

          return <div key={config.name}>{renderSkeleton(config.type)}</div>
        })}
      </div>
    )
  }

  // All props available, render the component
  return children
}

// Predefined prop configs for common component patterns
export const commonPropConfigs = {
  card: [
    { name: "title", type: "text-short" as const, required: true },
    { name: "description", type: "text" as const },
    { name: "badge", type: "badge" as const },
  ],
  tableRow: [
    { name: "name", type: "text-short" as const, required: true },
    { name: "status", type: "badge" as const },
    { name: "date", type: "date" as const },
    { name: "value", type: "number" as const },
  ],
  stat: [
    { name: "label", type: "text-short" as const, required: true },
    { name: "value", type: "number" as const, required: true },
  ],
  userCard: [
    { name: "name", type: "text-short" as const, required: true },
    { name: "role", type: "badge" as const },
    { name: "avatar", type: "avatar" as const },
  ],
}
