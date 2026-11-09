"use client"

// Charts Jarvis can render: BarGraph and LineGraph.
// Part of the agent render registry; ../registry.tsx combines every group.

import type { ComponentMap } from "./types"

export const chartComponents: ComponentMap<
  | "BarGraph"
  | "LineGraph"
> = {
  // --- Charts ---

  BarGraph: ({ props }) => {
    const data = props.data || []
    const maxVal = Math.max(
      ...data.map((d) => d.value),
      1
    )

    return (
      <div className="space-y-2">
        {props.title && (
          <div className="text-sm font-medium text-left">
            {props.title}
          </div>
        )}
        <div className="flex gap-2">
          {data.map((d, i) => (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div className="text-xs text-muted-foreground">
                {d.value}
              </div>
              <div className="w-full h-24 flex items-end">
                <div
                  className="w-full bg-primary rounded-t transition-all"
                  style={{
                    height: `${(d.value / maxVal) * 100}%`,
                    minHeight: 2,
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground truncate w-full text-center">
                {d.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  },

  LineGraph: ({ props }) => {
    const data = props.data || []
    const maxVal = Math.max(
      ...data.map((d) => d.value),
      1
    )
    const minVal = Math.min(
      ...data.map((d) => d.value),
      0
    )
    const range = maxVal - minVal || 1

    const w = 300
    const h = 100
    const pad = { top: 10, right: 10, bottom: 10, left: 10 }
    const cw = w - pad.left - pad.right
    const ch = h - pad.top - pad.bottom

    const pts = data.map((d, i) => ({
      x:
        pad.left +
        (data.length > 1
          ? (i / (data.length - 1)) * cw
          : cw / 2),
      y:
        pad.top +
        ch -
        ((d.value - minVal) / range) * ch,
      ...d,
    }))

    const pathD =
      pts.length > 0
        ? `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`
        : ""

    return (
      <div className="space-y-2">
        {props.title && (
          <div className="text-sm font-medium text-left">
            {props.title}
          </div>
        )}
        <div className="relative h-28">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full h-full"
          >
            {[pad.top, pad.top + ch / 2, h - pad.bottom].map(
              (y, i) => (
                <line
                  key={i}
                  x1={pad.left}
                  y1={y}
                  x2={w - pad.right}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeWidth="1"
                />
              )
            )}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary"
              />
            )}
            {pts.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r="4"
                className="fill-primary"
              />
            ))}
          </svg>
        </div>
        {data.length > 0 && (
          <div className="flex justify-between">
            {data.map((d, i) => (
              <div
                key={i}
                className="text-xs text-muted-foreground text-center"
                style={{
                  width: `${100 / data.length}%`,
                }}
              >
                {d.label}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },
}
