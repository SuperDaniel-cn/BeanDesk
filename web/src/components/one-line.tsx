import { useEffect, useRef, useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function OneLine({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const next = node.scrollWidth > node.clientWidth
      setOverflows(next)
      if (!next) setOpen(false)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [text])

  return (
    <Tooltip open={overflows && open} onOpenChange={setOpen} disableHoverableContent>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block min-w-0 truncate', className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-left whitespace-normal">{text}</TooltipContent>
    </Tooltip>
  )
}
