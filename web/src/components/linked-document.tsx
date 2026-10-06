import { useEffect, useState } from 'react'
import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { fileLeaf } from '@/lib/format'
import { favaClient } from '@/lib/fava-client'

export function LinkedDocument({ filename }: { filename: string | null }) {
  const { t } = useI18n()
  const desktop = isTauri()
  const [preview, setPreview] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!filename || !desktop) return
    let cancelled = false
    let objectUrl: string | null = null
    setPreview(null)
    setFailed(false)
    favaClient.readDocument(filename).then(
      (blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreview(objectUrl)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [desktop, filename])

  const href = !filename ? null : desktop ? preview : favaClient.getDocumentUrl(filename)
  const downloadName = filename ? fileLeaf(filename) : 'document'

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('journal.documentsHeading')}
        </span>
        {href ? (
          <Button variant="link" asChild>
            <a
              href={href}
              download={downloadName}
              target={desktop ? undefined : '_blank'}
              rel={desktop ? undefined : 'noreferrer'}
            >
              <DownloadIcon data-icon="inline-start" />
              {t('journal.download')}
            </a>
          </Button>
        ) : null}
      </div>

      {!filename ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>{t('journal.noDocumentTitle')}</EmptyTitle>
            <EmptyDescription>{t('journal.noDocumentBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : failed ? (
        <Alert variant="destructive">
          <AlertDescription>{t('common.errorFallback')}</AlertDescription>
        </Alert>
      ) : !href ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-xl border bg-muted/10 shadow-xs">
          {filename.toLowerCase().endsWith('.pdf') ? (
            <iframe
              src={href}
              className="h-80 w-full border-0 sm:h-[460px]"
              title={t('journal.previewTitle')}
            />
          ) : (
            <div className="flex items-center justify-center p-4">
              <img
                src={href}
                alt={t('journal.previewAlt')}
                className="max-h-80 max-w-full rounded-lg object-contain sm:max-h-[460px]"
              />
            </div>
          )}
          <div className="truncate bg-muted/40 px-4 py-2 text-center font-mono text-xs text-muted-foreground">
            {downloadName}
          </div>
        </div>
      )}
    </div>
  )
}
