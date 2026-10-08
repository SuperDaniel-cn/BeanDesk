import { useEffect, useRef, useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function OneLine({
  text,
  detail,
  className,
}: {
  text: string
  detail?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [open, setOpen] = useState(false)
  const hint = detail && detail !== text ? detail : text
  const hasDetail = hint !== text

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const next = node.scrollWidth > node.clientWidth
      setOverflows(next)
      if (!next && !hasDetail) setOpen(false)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [text, hasDetail])

  return (
    <Tooltip open={(hasDetail || overflows) && open} onOpenChange={setOpen} disableHoverableContent>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block min-w-0 truncate', className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent
        className={cn('max-w-sm text-left whitespace-normal', hasDetail && 'font-mono')}
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}
