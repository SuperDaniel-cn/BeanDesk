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

type Preview =
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'text'; text: string; url: string }
  | { kind: 'file'; url: string }

export function LinkedDocument({ filename }: { filename: string | null }) {
  if (!filename) return <MissingDocument />
  return <DocumentPreview key={filename} filename={filename} />
}

function MissingDocument() {
  const { t } = useI18n()
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">{t('journal.documentsHeading')}</span>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>{t('journal.noDocumentTitle')}</EmptyTitle>
          <EmptyDescription>{t('journal.noDocumentBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

function DocumentPreview({ filename }: { filename: string }) {
  const { t } = useI18n()
  const desktop = isTauri()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    favaClient.readDocument(filename).then(
      async (blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        const kind = previewKind(filename, blob.type)
        if (kind === 'text') {
          const text = await blob.text()
          if (cancelled) return
          setPreview({ kind, text, url: objectUrl })
          return
        }
        setPreview({ kind, url: objectUrl })
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filename])

  const href = preview?.url ?? null
  const downloadName = fileLeaf(filename)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t('journal.documentsHeading')}</span>
        {href ? (
          <Button variant="link" asChild>
            <a href={href} download={downloadName} target={desktop ? undefined : '_blank'} rel={desktop ? undefined : 'noreferrer'}>
              <DownloadIcon data-icon="inline-start" />
              {t('journal.download')}
            </a>
          </Button>
        ) : (
          <Button variant="link" disabled>
            <DownloadIcon data-icon="inline-start" />
            {t('journal.download')}
          </Button>
        )}
      </div>

      <div className="min-w-0 overflow-hidden rounded-xl border bg-muted/10 shadow-xs">
        <div className="h-[min(20rem,calc(100dvh-16rem))] sm:h-[min(28.75rem,calc(100dvh-16rem))]">
          {failed ? (
            <div className="flex h-full items-center p-4">
              <Alert variant="destructive">
                <AlertDescription>{t('common.errorFallback')}</AlertDescription>
              </Alert>
            </div>
          ) : !preview ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : preview.kind === 'pdf' ? (
            <iframe src={preview.url} className="h-full w-full border-0" title={t('journal.previewTitle')} />
          ) : preview.kind === 'image' ? (
            <div className="flex h-full items-center justify-center p-4">
              <img
                src={preview.url}
                alt={t('journal.previewAlt')}
                className="max-h-full max-w-full object-contain"
                onError={() => setFailed(true)}
              />
            </div>
          ) : preview.kind === 'text' ? (
            <pre className="h-full overflow-auto p-4 text-left font-mono text-[0.8rem] whitespace-pre-wrap">
              {preview.text}
            </pre>
          ) : (
            <Empty className="h-full border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>{t('journal.previewAlt')}</EmptyTitle>
                <EmptyDescription>{downloadName}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        <div className="truncate border-t bg-muted/40 px-4 py-2 text-center font-mono text-xs text-muted-foreground">
          {downloadName}
        </div>
      </div>
    </div>
  )
}

function previewKind(filename: string, type: string): Preview['kind'] {
  const lower = filename.toLowerCase()
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return 'image'
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (type.startsWith('text/') || /\.(txt|csv|md|json|bean)$/.test(lower)) return 'text'
  return 'file'
}
