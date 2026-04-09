import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AccordionItem } from '@/components/ui/accordion'
import { AlertCircle, ChevronDown, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { UsageRecord } from '@/types/usage'

interface RequestPayload {
  model: string
  messages: Array<{ role: string; content: string | Array<unknown> }>
  system?: string | Array<unknown>
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: unknown[]
  tool_choice?: unknown
  [key: string]: unknown
}

interface RequestDetailDrawerProps {
  record: UsageRecord | null
  onClose: () => void
}

interface LogResponse {
  requestId: string
  payload: Record<string, unknown> | null
  reason?: string
  error?: string
}

// Escape HTML to prevent XSS when rendering user/assistant content
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function RequestDetailDrawer({ record, onClose }: RequestDetailDrawerProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<LogResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!record) return
    let ignored = false
    setLoading(true)
    setData(null)

    api.getUsageRequestLog(record.requestId)
      .then((result) => {
        if (!ignored) setData(result)
      })
      .catch((err: Error) => {
        if (!ignored) setData({ requestId: record.requestId, payload: null, error: err.message || 'Network error' })
      })
      .finally(() => {
        if (!ignored) setLoading(false)
      })

    return () => {
      ignored = true
    }
  }, [record])

  const formatLatency = (ms?: number) => {
    if (!ms) return '-'
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
    return `${Math.round(ms)}ms`
  }

  const payload = data?.payload as RequestPayload | null
  const roleList = payload?.messages?.map((m) => m.role).join(' → ') || ''

  // Message selection state
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null)
  const selectedMessage = selectedMessageIndex !== null ? payload?.messages?.[selectedMessageIndex] : null

  // Extract params (exclude known structural fields)
  const PARAM_KEYS = new Set(['model', 'messages', 'system', 'stream', 'tools', 'tool_choice'])
  const requestParams = payload
    ? Object.entries(payload).filter(([k]) => !PARAM_KEYS.has(k))
    : []

  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col p-0 w-[800px] max-w-full">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-base">Request Detail</SheetTitle>
              <p className="text-xs text-muted-foreground font-mono break-all">{record?.requestId}</p>
            </div>
            {payload && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `request-${record?.requestId || 'detail'}.json`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="px-2 py-1 rounded text-xs hover:bg-muted-foreground/10 transition-colors flex items-center gap-1"
                title="Download JSON"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
                <span>Download</span>
              </button>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4">
            {/* Basic Info */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Basic Info</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Provider</span>
                <span>{record?.provider ?? '-'}</span>
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-xs break-all">{record?.model ?? '-'}</span>
                <span className="text-muted-foreground">Stream</span>
                <Badge variant="outline">{payload?.stream ? 'true' : 'false'}</Badge>
                <span className="text-muted-foreground">Duration</span>
                <span>{formatLatency(record?.duration)}</span>
                <span className="text-muted-foreground">TTFT</span>
                <span>{formatLatency(record?.timeToFirstToken)}</span>
                <span className="text-muted-foreground">Input Tokens</span>
                <span>{record?.inputTokens?.toLocaleString() ?? '-'}</span>
                <span className="text-muted-foreground">Output Tokens</span>
                <span>{record?.outputTokens?.toLocaleString() ?? '-'}</span>
              </div>
            </section>

            {/* Messages */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Messages ({payload?.messages?.length ?? 0})</h3>
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : !payload ? (
                <p className="text-sm text-muted-foreground py-2">{data?.reason || 'No payload found.'}</p>
              ) : (
                <div className="space-y-1">
                  {/* Messages in reverse order (newest first, highest number at top) */}
                  {payload.messages?.map((msg, i) => {
                    const actualIndex = payload.messages!.length - i - 1
                    const actualMsg = payload.messages![actualIndex]
                    // Numbering: oldest message is #1, newest is #N
                    const displayIndex = payload.messages!.length - i
                    return (
                      <div key={actualIndex}>
                        <button
                          onClick={() => setSelectedMessageIndex(selectedMessageIndex === actualIndex ? null : actualIndex)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-muted transition-colors text-left border',
                            selectedMessageIndex === actualIndex && 'bg-muted border-primary'
                          )}
                        >
                          <Badge variant="secondary" className="text-xs shrink-0">{actualMsg.role}</Badge>
                          <span className="text-xs text-muted-foreground shrink-0">#{displayIndex}</span>
                          <ChevronDown className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            selectedMessageIndex === actualIndex && 'rotate-180'
                          )} />
                          <span className="truncate text-xs">
                            {typeof actualMsg.content === 'string'
                              ? actualMsg.content.slice(0, 80) + (actualMsg.content.length > 80 ? '...' : '')
                              : `[${actualMsg.content?.length ?? 0} items]`}
                          </span>
                        </button>
                        {selectedMessageIndex === actualIndex && (
                          <div className="border border-t-0 rounded-b-md p-3 bg-muted/30">
                            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto">
                              {typeof actualMsg.content === 'string'
                                ? actualMsg.content
                                : JSON.stringify(actualMsg.content, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* System message at the end */}
                  {payload.system && (
                    <div>
                      <button
                        onClick={() => setSelectedMessageIndex(selectedMessageIndex === -1 ? null : -1)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-muted transition-colors text-left border',
                          selectedMessageIndex === -1 && 'bg-muted border-primary'
                        )}
                      >
                        <Badge variant="outline" className="text-xs shrink-0">system</Badge>
                        <ChevronDown className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                          selectedMessageIndex === -1 && 'rotate-180'
                        )} />
                        <span className="truncate text-xs">
                          {typeof payload.system === 'string'
                            ? payload.system.slice(0, 80) + (payload.system.length > 80 ? '...' : '')
                            : `[${payload.system?.length ?? 0} items]`}
                        </span>
                      </button>
                      {selectedMessageIndex === -1 && (
                        <div className="border border-t-0 rounded-b-md p-3 bg-muted/30">
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[600px] overflow-y-auto">
                            {typeof payload.system === 'string'
                              ? payload.system
                              : JSON.stringify(payload.system, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Request Parameters */}
              {requestParams.length > 0 && (
                <AccordionItem value="params" trigger={<span>Request Parameters</span>} className="mt-4">
                  <div className="space-y-1 text-sm">
                    {requestParams.map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-foreground font-mono text-xs shrink-0">{k}:</span>
                        <span className="font-mono text-xs break-all">
                          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}

              {/* Raw JSON */}
              {payload && (
                <AccordionItem value="raw-json" trigger={<span>Raw JSON</span>} className="mt-4">
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-96">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </AccordionItem>
              )}
            </section>

            {/* Error state */}
            {data?.error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {data.error}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
