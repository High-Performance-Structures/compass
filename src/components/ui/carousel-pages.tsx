"use client"

import * as React from "react"
import useEmblaCarousel from "embla-carousel-react"
import { cn } from "@/lib/utils"

interface CarouselPagesProps {
  children: React.ReactNode[]
  className?: string
}

export function CarouselPages({ children, className }: CarouselPagesProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    skipSnaps: false,
    dragFree: false,
    watchDrag: (emblaApi, evt) => {
      // Don't capture drag events on interactive elements
      const target = evt.target as HTMLElement
      const interactiveElements = ['INPUT', 'SELECT', 'BUTTON', 'A', 'TEXTAREA']
      const isInteractive = interactiveElements.includes(target.tagName)
      const isSlider = target.closest('[role="slider"]')
      const isSwitch = target.closest('[role="switch"]')
      const isSelect = target.closest('[role="combobox"]') || target.closest('[role="listbox"]')

      return !isInteractive && !isSlider && !isSwitch && !isSelect
    }
  })
  const [selectedIndex, setSelectedIndex] = React.useState(0)

  const onSelect = React.useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  React.useEffect(() => {
    if (!emblaApi) return
    onSelect()
    emblaApi.on("select", onSelect)
    emblaApi.on("reInit", onSelect)
    return () => {
      emblaApi.off("select", onSelect)
      emblaApi.off("reInit", onSelect)
    }
  }, [emblaApi, onSelect])

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden touch-pan-x" ref={emblaRef}>
        <div className="flex">
          {children.map((child, index) => (
            <div
              key={index}
              className="min-w-0 shrink-0 grow-0 basis-full"
            >
              {child}
            </div>
          ))}
        </div>
      </div>

      {children.length > 1 && (
        <div className="flex justify-center gap-1.5 pb-1">
          {children.map((_, index) => (
            <button
              key={index}
              type="button"
              className={cn(
                "h-1.5 rounded-full transition-all",
                index === selectedIndex
                  ? "bg-primary w-6"
                  : "bg-muted-foreground/30 w-1.5"
              )}
              onClick={() => emblaApi?.scrollTo(index)}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
