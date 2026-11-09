"use client"

// Layout and text pieces Jarvis can render: Card, Stack, Grid, Divider,
// Heading, Text.
// Part of the agent render registry; ../registry.tsx combines every group.

import { Separator } from "@/components/ui/separator"
import type { ComponentMap } from "./types"

export const layoutComponents: ComponentMap<
  | "Card"
  | "Stack"
  | "Grid"
  | "Divider"
  | "Heading"
  | "Text"
> = {
  // --- Layout ---

  Card: ({ props, children }) => {
    const maxW =
      props.maxWidth === "sm"
        ? "max-w-xs sm:min-w-[280px]"
        : props.maxWidth === "md"
          ? "max-w-sm sm:min-w-[320px]"
          : props.maxWidth === "lg"
            ? "max-w-md sm:min-w-[360px]"
            : "w-full"
    const centered = props.centered ? "mx-auto" : ""
    const accent = props.title
      ? "border-t-2 border-t-primary/20"
      : ""

    return (
      <div
        className={`border border-border rounded-xl shadow-sm p-5 bg-card text-card-foreground overflow-hidden ${accent} ${maxW} ${centered}`}
      >
        {props.title && (
          <div className="font-semibold text-sm mb-1 text-left">
            {props.title}
          </div>
        )}
        {props.description && (
          <div className="text-xs text-muted-foreground mb-3 text-left">
            {props.description}
          </div>
        )}
        <div className="space-y-3">{children}</div>
      </div>
    )
  },

  Stack: ({ props, children }) => {
    const horiz = props.direction === "horizontal"
    const gap =
      props.gap === "lg"
        ? "gap-4"
        : props.gap === "sm"
          ? "gap-2"
          : props.gap === "none"
            ? "gap-0"
            : "gap-3"
    const align =
      props.align === "center"
        ? "items-center"
        : props.align === "end"
          ? "items-end"
          : props.align === "stretch"
            ? "items-stretch"
            : "items-start"
    const justify =
      props.justify === "center"
        ? "justify-center"
        : props.justify === "end"
          ? "justify-end"
          : props.justify === "between"
            ? "justify-between"
            : props.justify === "around"
              ? "justify-around"
              : ""

    return (
      <div
        className={`flex ${horiz ? "flex-row flex-wrap" : "flex-col"} ${gap} ${align} ${justify}`}
      >
        {children}
      </div>
    )
  },

  Grid: ({ props, children }) => {
    const cols =
      props.columns === 4
        ? "grid-cols-4"
        : props.columns === 3
          ? "grid-cols-3"
          : props.columns === 2
            ? "grid-cols-2"
            : "grid-cols-1"
    const gap =
      props.gap === "lg"
        ? "gap-4"
        : props.gap === "sm"
          ? "gap-2"
          : "gap-3"

    return (
      <div className={`grid ${cols} ${gap}`}>
        {children}
      </div>
    )
  },

  Divider: () => <Separator className="my-3" />,

  // --- Typography ---

  Heading: ({ props }) => {
    const level = props.level ?? "h2"
    const cls =
      level === "h1"
        ? "text-2xl font-bold"
        : level === "h3"
          ? "text-base font-semibold"
          : level === "h4"
            ? "text-sm font-semibold"
            : "text-lg font-semibold"

    const Tag = level
    return (
      <Tag className={`${cls} text-left`}>
        {props.text}
      </Tag>
    )
  },

  Text: ({ props }) => {
    const cls =
      props.variant === "caption"
        ? "text-xs"
        : props.variant === "muted"
          ? "text-sm text-muted-foreground"
          : "text-sm"

    return <p className={`${cls} text-left`}>{props.text}</p>
  },
}
