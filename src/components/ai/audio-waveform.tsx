"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

const BAR_W = 2
const GAP = 1
const SLOT = BAR_W + GAP
const MAX_H = 32
const MIN_H = 2
const SAMPLE_MS = 40

interface AudioWaveformProps {
  readonly stream: MediaStream
  readonly className?: string
}

export function AudioWaveform({
  stream,
  className,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const audioCtx = new AudioContext()
    const source =
      audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    const timeDomain = new Uint8Array(analyser.fftSize)

    // calculate how many bars fit in the container
    const barCount = Math.floor(
      container.clientWidth / SLOT
    )
    if (barCount <= 0) return

    // amplitude history
    const amplitudes = new Float32Array(barCount)

    // pre-create all bars as subtle dots
    const barEls: HTMLDivElement[] = []
    const frag = document.createDocumentFragment()
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement("div")
      bar.style.cssText =
        `width:${BAR_W}px;` +
        `height:${MIN_H}px;` +
        "border-radius:9999px;" +
        "background:currentColor;" +
        "flex-shrink:0;" +
        "opacity:0.15;"
      frag.appendChild(bar)
      barEls.push(bar)
    }
    container.appendChild(frag)

    let cursor = 0

    const interval = setInterval(() => {
      analyser.getByteTimeDomainData(timeDomain)

      // RMS amplitude
      let sum = 0
      for (let i = 0; i < timeDomain.length; i++) {
        const v = (timeDomain[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / timeDomain.length)

      // non-linear boost so speech is clearly visible
      const shaped = Math.pow(Math.min(1, rms * 5), 0.6)

      if (cursor < barCount) {
        // filling phase: write one bar at a time
        amplitudes[cursor] = shaped
        const h = Math.max(MIN_H, shaped * MAX_H)
        barEls[cursor].style.height = `${h}px`
        barEls[cursor].style.opacity = "1"
        cursor++
      } else {
        // scrolling phase: shift left, append new
        for (let i = 0; i < barCount - 1; i++) {
          amplitudes[i] = amplitudes[i + 1]
        }
        amplitudes[barCount - 1] = shaped

        for (let i = 0; i < barCount; i++) {
          const h = Math.max(
            MIN_H,
            amplitudes[i] * MAX_H
          )
          barEls[i].style.height = `${h}px`
        }
      }
    }, SAMPLE_MS)

    return () => {
      clearInterval(interval)
      audioCtx.close()
      container.textContent = ""
    }
  }, [stream])

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center overflow-hidden",
        className
      )}
      style={{ gap: `${GAP}px` }}
    />
  )
}
