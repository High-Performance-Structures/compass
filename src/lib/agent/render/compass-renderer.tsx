"use client"

import { useMemo, type ReactNode } from "react"
import {
  Renderer,
  type ComponentRegistry,
  type Spec,
  StateProvider,
  VisibilityProvider,
  ActionProvider,
} from "@json-render/react"

import {
  components,
  Fallback,
  type StreamingState,
} from "./registry"
import { executeAction, actionHandlers } from "./actions"
import {
  ComponentLoadingWrapper,
  type PropConfig,
} from "@/components/agent/component-loading-wrapper"

interface CompassRendererProps {
  readonly spec: Spec | null
  readonly data?: Record<string, unknown>
  readonly loading?: boolean
  readonly streamingState?: StreamingState
  readonly propConfigs?: Record<string, PropConfig[]>
  readonly enablePropSkeletons?: boolean
}

function buildRegistry(
  loading?: boolean,
  streamingState?: StreamingState,
  propConfigs?: Record<string, PropConfig[]>,
  enablePropSkeletons?: boolean
): ComponentRegistry {
  const registry: ComponentRegistry = {}

  for (const [name, Component] of Object.entries(components)) {
    registry[name] = (renderProps: {
      element: {
        props: Record<string, unknown>
        type: string
      }
      children?: ReactNode
    }) => {
      const componentProps = renderProps.element.props
      const componentPropConfigs = propConfigs?.[name]

      // If prop-level skeletons are enabled and configs exist, wrap component
      if (
        enablePropSkeletons &&
        componentPropConfigs &&
        componentPropConfigs.length > 0
      ) {
        return (
          <ComponentLoadingWrapper
            props={componentProps}
            propConfigs={componentPropConfigs}
            loading={loading}
          >
            <Component
              props={componentProps as never}
              onAction={(a: {
                name: string
                params?: Record<string, unknown>
              }) => executeAction(a.name, a.params)}
              loading={loading}
              streamingState={streamingState}
            >
              {renderProps.children}
            </Component>
          </ComponentLoadingWrapper>
        )
      }

      // Standard rendering without prop-level skeletons
      return (
        <Component
          props={componentProps as never}
          onAction={(a: {
            name: string
            params?: Record<string, unknown>
          }) => executeAction(a.name, a.params)}
          loading={loading}
          streamingState={streamingState}
        >
          {renderProps.children}
        </Component>
      )
    }
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
  streamingState,
  propConfigs,
  enablePropSkeletons = false,
}: CompassRendererProps): ReactNode {
  const registry = useMemo(
    () =>
      buildRegistry(
        loading,
        streamingState,
        propConfigs,
        enablePropSkeletons
      ),
    [loading, streamingState, propConfigs, enablePropSkeletons]
  )

  if (!spec) return null

  return (
    <StateProvider initialState={data}>
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
    </StateProvider>
  )
}
