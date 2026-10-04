import { Calendar, Check, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTimeFilter } from '@/lib/time-context'
import { useI18n } from '@/i18n'
import { formatPeriodLabel } from '@/lib/period-label'
import { cn } from '@/lib/utils'

export function TimeFilterSelector({ className }: { className?: string }) {
  const { timeFilter, setTimeFilter, availableYears, clearFilter, isAllTime } = useTimeFilter()
  const { t } = useI18n()

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={isAllTime ? 'outline' : 'secondary'}
          >
            <Calendar className="hidden text-muted-foreground sm:block" data-icon="inline-start" />
            <span className="max-w-[100px] truncate sm:max-w-none">
              {formatPeriodLabel(timeFilter, t)}
            </span>
            <ChevronDown className="hidden text-muted-foreground opacity-70 sm:block" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('time.filterLabel')}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => clearFilter()}>
              <span>{t('time.allTime')}</span>
              {isAllTime && <Check />}
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t('time.yearAndQuarter')}
            </DropdownMenuLabel>

            {availableYears.map((year) => (
              <DropdownMenuSub key={year}>
                <DropdownMenuSubTrigger>
                  <span>{year}</span>
                  {timeFilter.startsWith(year) && (
                    <span className="ml-auto size-1.5 rounded-full bg-primary" />
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setTimeFilter(year)}>
                      <span>
                        {year} ({t('time.year')})
                      </span>
                      {timeFilter === year ? <Check /> : null}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>

                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('time.quarter')}</DropdownMenuLabel>
                    {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => {
                      const val = `${year}-${q}`
                      return (
                        <DropdownMenuItem key={val} onClick={() => setTimeFilter(val)}>
                          <span>{formatPeriodLabel(val, t)}</span>
                          {timeFilter === val ? <Check /> : null}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>

                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('time.month')}</DropdownMenuLabel>
                    <div className="grid grid-cols-4 gap-1 p-1">
                      {Array.from({ length: 12 }, (_, i) => {
                        const m = String(i + 1).padStart(2, '0')
                        const val = `${year}-${m}`
                        return (
                          <Button
                            key={val}
                            type="button"
                            size="xs"
                            variant={timeFilter === val ? 'default' : 'ghost'}
                            onClick={() => setTimeFilter(val)}
                          >
                            {m}
                          </Button>
                        )
                      })}
                    </div>
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {!isAllTime && (
        <Hint label={t('time.allTime')}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clearFilter}
            aria-label={t('time.allTime')}
          >
            <X />
          </Button>
        </Hint>
      )}
    </div>
  )
}
