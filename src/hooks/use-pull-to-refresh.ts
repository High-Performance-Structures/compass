"use client"

import { useState, useRef, useCallback } from "react"

const TRIGGER_THRESHOLD = 80
const MAX_PULL = 120

interface PullToRefreshResult {
  isRefreshing: boolean
  pullDistance: number
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
}

export function usePullToRefresh(
  onRefresh: () => Promise<void>
): PullToRefreshResult {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startY = useRef<number | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || window.scrollY > 0) return
    const currentY = e.touches[0].clientY
    const distance = Math.max(
      0,
      Math.min(currentY - startY.current, MAX_PULL)
    )
    setPullDistance(distance)
  }, [])

  const onTouchEnd = useCallback(async () => {
    if (pullDistance > TRIGGER_THRESHOLD) {
      setIsRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
      }
    }
    setPullDistance(0)
    startY.current = null
  }, [pullDistance, onRefresh])

  return {
    isRefreshing,
    pullDistance,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  }
}
