// Types shared by the agent render registry: the catalog's component names,
// the props each one takes (inferred from ./catalog.ts), and the shape of a
// renderer.
import type { ReactNode } from "react"
import type { z } from "zod"

import { compassCatalog } from "../catalog"

// Infer prop types from catalog
export type CatalogComponents =
  typeof compassCatalog.data.components

export type InferProps<K extends keyof CatalogComponents> =
  CatalogComponents[K] extends { props: z.ZodType<infer P> }
    ? P
    : never

export type StreamingState =
  | "started"
  | "streaming"
  | "done"

export interface ComponentContext<K extends keyof CatalogComponents> {
  readonly props: InferProps<K>
  readonly children?: ReactNode
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
  readonly loading?: boolean
  readonly streamingState?: StreamingState
}

export type ComponentFn<K extends keyof CatalogComponents> = (
  ctx: ComponentContext<K>
) => ReactNode


/** A group of renderers, one per catalog component name in K. */
export type ComponentMap<K extends keyof CatalogComponents> = {
  [P in K]: ComponentFn<P>
}
