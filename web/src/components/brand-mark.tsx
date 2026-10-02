import { cn } from '@/lib/utils'

/** Letter T in a circle. Fill follows the theme: black on a light page, white on a dark page. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-5 shrink-0', className)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M16 1a15 15 0 1 0 0 30 15 15 0 1 0 0-30zm-8 8h16v3.2h-6.4V23h-3.2v-10.8H8z"
      />
    </svg>
  )
}
