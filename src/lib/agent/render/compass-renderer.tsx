"use client"

import { useMemo, type ReactNode } from "react"
import {
  Renderer,
  type ComponentRegistry,
  type Spec,
  DataProvider,
  VisibilityProvider,
  ActionProvider,
} from "@json-render/react"

import { components, Fallback } from "./registry"
import { executeAction, actionHandlers } from "./actions"

interface CompassRendererProps {
  readonly spec: Spec | null
  readonly data?: Record<string, unknown>
  readonly loading?: boolean
}

function buildRegistry(
  loading?: boolean
): ComponentRegistry {
  const registry: ComponentRegistry = {}

  for (const [name, Component] of Object.entries(
    components
  )) {
    registry[name] = (renderProps: {
      element: {
        props: Record<string, unknown>
        type: string
      }
      children?: ReactNode
    }) => (
      <Component
        props={renderProps.element.props as never}
        onAction={(a: {
          name: string
          params?: Record<string, unknown>
        }) => executeAction(a.name, a.params)}
        loading={loading}
      >
        {renderProps.children}
      </Component>
    )
  }

  return registry
}

const fallbackRegistry = (renderProps: {
  element: { type: string }
}) => <Fallback type={renderProps.element.type} />

export function CompassRenderer({
  spec,
  data,
  loading,
}: CompassRendererProps): ReactNode {
  const registry = useMemo(
    () => buildRegistry(loading),
    [loading]
  )

  if (!spec) return null

  return (
    <DataProvider initialData={data}>
      <VisibilityProvider>
        <ActionProvider handlers={actionHandlers}>
          <Renderer
            spec={spec}
            registry={registry}
            fallback={fallbackRegistry}
            loading={loading}
          />
        </ActionProvider>
      </VisibilityProvider>
    </DataProvider>
  )
}
