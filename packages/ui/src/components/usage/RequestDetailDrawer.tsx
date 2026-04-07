import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AccordionItem } from '@/components/ui/accordion'
import { AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { UsageRecord } from '@/types/usage'

interface RequestPayload {
  model: string
  messages: Array<{ role: string; content: string | Array<unknown> }>
  system?: string
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
      .catch(() => {
        if (!ignored) setData({ requestId: record.requestId, payload: null, error: 'Network error' })
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

  // Extract params (exclude known structural fields)
  const PARAM_KEYS = new Set(['model', 'messages', 'system', 'stream', 'tools', 'tool_choice'])
  const requestParams = payload
    ? Object.entries(payload).filter(([k]) => !PARAM_KEYS.has(k))
    : []

  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col p-0 w-[600px] max-w-full">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="text-base">Request Detail</SheetTitle>
          <p className="text-xs text-muted-foreground font-mono break-all">{record?.requestId}</p>
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
              <AccordionItem
                value="messages"
                trigger={<span>Messages ({payload?.messages?.length ?? 0}) — {roleList || '-'}</span>}
                defaultOpen
              >
                {loading ? (
                  <Skeleton className="h-16 w-full" />
                ) : !payload ? (
                  <p className="text-sm text-muted-foreground py-2">No payload found.</p>
                ) : (
                  <div className="space-y-3">
                    {payload.messages?.map((msg, i) => (
                      <div key={i} className="border rounded-md p-3">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="secondary" className="text-xs">{msg.role}</Badge>
                          <span className="text-xs text-muted-foreground">#{i + 1}</span>
                        </div>
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
                          {typeof msg.content === 'string'
                            ? escapeHtml(msg.content)
                            : JSON.stringify(msg.content, null, 2)}
                        </pre>
                      </div>
                    ))}
                    {payload.system && (
                      <div className="border rounded-md p-3">
                        <Badge variant="outline" className="text-xs mb-1">system</Badge>
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
                          {escapeHtml(payload.system)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </AccordionItem>

              {/* Request Parameters */}
              {requestParams.length > 0 && (
                <AccordionItem value="params" trigger={<span>Request Parameters</span>}>
                  <div className="space-y-1 text-sm">
                    {requestParams.map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-foreground font-mono text-xs shrink-0">{k}:</span>
                        <span className="font-mono text-xs break-all">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}

              {/* Raw JSON */}
              {payload && (
                <AccordionItem value="raw" trigger={<span>Raw JSON</span>}>
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
