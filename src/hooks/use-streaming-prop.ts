import { useRef, useEffect, useState } from "react"

interface StreamingPropState {
  readonly isStreaming: boolean
  readonly hasValue: boolean
  readonly arrivedAt: number | null
}

type StreamingPropsState = Record<string, StreamingPropState>

interface UseStreamingPropsResult {
  readonly props: StreamingPropsState
  readonly isPropStreaming: (propName: string) => boolean
  readonly hasPropValue: (propName: string) => boolean
  readonly allPropsArrived: boolean
  readonly pendingProps: string[]
}

interface UseStreamingPropsOptions {
  readonly propNames?: string[]
  readonly onPropArrived?: (propName: string) => void
  readonly onAllArrived?: () => void
}

// Tracks streaming state for component props
// Useful for showing prop-level skeletons during incremental rendering
export function useStreamingProps(
  currentProps: Record<string, unknown>,
  options: UseStreamingPropsOptions = {}
): UseStreamingPropsResult {
  const { propNames, onPropArrived, onAllArrived } = options
  const [props, setProps] = useState<StreamingPropsState>({})
  const prevPropsRef = useRef<Record<string, unknown>>({})

  useEffect(() => {
    const trackedProps = propNames ?? Object.keys(currentProps)
    const updates: StreamingPropsState = {}
    const arrivedCallbacks: string[] = []

    for (const propName of trackedProps) {
      const currentValue = currentProps[propName]
      const prevValue = prevPropsRef.current[propName]
      const hadValue =
        prevValue !== undefined && prevValue !== null && prevValue !== ""
      const nowHasValue =
        currentValue !== undefined &&
        currentValue !== null &&
        currentValue !== ""

      // Check if this prop just arrived
      if (!hadValue && nowHasValue) {
        updates[propName] = {
          isStreaming: false,
          hasValue: true,
          arrivedAt: Date.now(),
        }
        arrivedCallbacks.push(propName)
      } else if (hadValue && !nowHasValue) {
        // Value was removed (shouldn't normally happen, but handle it)
        updates[propName] = {
          isStreaming: false,
          hasValue: false,
          arrivedAt: null,
        }
      } else {
        // Keep existing state
        updates[propName] = {
          isStreaming: !nowHasValue,
          hasValue: nowHasValue,
          arrivedAt: props[propName]?.arrivedAt ?? null,
        }
      }
    }

    setProps((prev) => ({ ...prev, ...updates }))
    prevPropsRef.current = { ...currentProps }

    // Fire callbacks after state update
    for (const propName of arrivedCallbacks) {
      onPropArrived?.(propName)
    }

    // Check if all props arrived
    const allArrived = trackedProps.every(
      (name) => updates[name]?.hasValue ?? props[name]?.hasValue
    )
    if (allArrived && arrivedCallbacks.length > 0) {
      onAllArrived?.()
    }
  }, [currentProps, propNames, onPropArrived, onAllArrived, props])

  const isPropStreaming = (propName: string): boolean => {
    return props[propName]?.isStreaming ?? true
  }

  const hasPropValue = (propName: string): boolean => {
    return props[propName]?.hasValue ?? false
  }

  const pendingProps = Object.entries(props)
    .filter(([, state]) => state.isStreaming)
    .map(([name]) => name)

  const allPropsArrived = pendingProps.length === 0

  return {
    props,
    isPropStreaming,
    hasPropValue,
    allPropsArrived,
    pendingProps,
  }
}

// Simpler hook for tracking a single prop's streaming state
export function useStreamingProp(
  value: unknown,
  options: {
    readonly onArrived?: () => void
  } = {}
): StreamingPropState {
  const { onArrived } = options
  const [state, setState] = useState<StreamingPropState>({
    isStreaming: true,
    hasValue: false,
    arrivedAt: null,
  })
  const prevValueRef = useRef<unknown>(undefined)

  useEffect(() => {
    const hasValue =
      value !== undefined && value !== null && value !== ""
    const hadValue =
      prevValueRef.current !== undefined &&
      prevValueRef.current !== null &&
      prevValueRef.current !== ""

    if (!hadValue && hasValue) {
      setState({
        isStreaming: false,
        hasValue: true,
        arrivedAt: Date.now(),
      })
      onArrived?.()
    } else if (!hasValue) {
      setState({
        isStreaming: true,
        hasValue: false,
        arrivedAt: null,
      })
    }

    prevValueRef.current = value
  }, [value, onArrived])

  return state
}
