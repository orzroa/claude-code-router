import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Calendar, Download, Trash2, RefreshCw, TrendingUp, Zap, Clock, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Toast } from '@/components/ui/toast';

// Types
interface UsageSummary {
  startDate: string;
  endDate: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  byProvider?: ProviderStats[];
  byModel?: ModelStats[];
  byDate?: DailyUsageSummary[];
}

interface ProviderStats {
  provider: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  models: ModelStats[];
}

interface ModelStats {
  model: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface DailyUsageSummary {
  date: string;
  provider: string;
  model: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface UsageFilters {
  providers: string[];
  models: string[];
  dateRange: { startDate: string; endDate: string } | null;
}

interface UsageRecord {
  id: string;
  timestamp: string;
  date: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  stream: boolean;
}

// Format numbers
function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatTokens(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function UsagePage() {
  const { t } = useTranslation();

  // State
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [filters, setFilters] = useState<UsageFilters | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  // Cleanup dialog state
  const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false);
  const [cleanupRetentionDays, setCleanupRetentionDays] = useState(90);
  const [cleanupDryRun, setCleanupDryRun] = useState(true);
  const [cleanupResult, setCleanupResult] = useState<any>(null);

  // Fetch filters on mount
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const data = await api.getUsageFilters();
        setFilters(data);

        // Set default date range
        if (data.dateRange) {
          setStartDate(data.dateRange.startDate);
          setEndDate(data.dateRange.endDate);
        } else {
          const today = new Date().toISOString().split('T')[0];
          setStartDate(today);
          setEndDate(today);
        }
      } catch (error) {
        console.error('Failed to fetch filters:', error);
      }
    };

    fetchFilters();
  }, []);

  // Fetch usage data
  const fetchUsage = useCallback(async () => {
    if (!startDate || !endDate) return;

    setIsLoading(true);
    try {
      const [summaryData, recordsData] = await Promise.all([
        api.getUsageSummary({ startDate, endDate, provider: provider || undefined, model: model || undefined }),
        api.getUsageRecords({ startDate, endDate, provider: provider || undefined, model: model || undefined, limit: 50 }),
      ]);

      setSummary(summaryData);
      setRecords(recordsData.records);
    } catch (error) {
      console.error('Failed to fetch usage:', error);
      setToast({ message: t('usage.load_failed'), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, provider, model, t]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Export handler
  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const content = await api.exportUsage({
        format,
        startDate,
        endDate,
        provider: provider || undefined,
        model: model || undefined,
      });

      // Download file
      const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-export-${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setToast({ message: t('usage.export_success'), type: 'success' });
    } catch (error) {
      console.error('Failed to export:', error);
      setToast({ message: t('usage.export_failed'), type: 'error' });
    }
  };

  // Cleanup handler
  const handleCleanup = async () => {
    try {
      const result = await api.cleanupUsage({
        retentionDays: cleanupRetentionDays,
        dryRun: cleanupDryRun,
      });

      setCleanupResult(result);

      if (!cleanupDryRun && result.success) {
        setToast({ message: t('usage.cleanup_success', { count: result.deletedCount }), type: 'success' });
        setIsCleanupDialogOpen(false);
        fetchUsage();
      }
    } catch (error) {
      console.error('Failed to cleanup:', error);
      setToast({ message: t('usage.cleanup_failed'), type: 'error' });
    }
  };

  if (isLoading && !summary) {
    return (
      <div className="h-screen bg-gray-50 font-sans flex items-center justify-center">
        <div className="text-gray-500">{t('usage.loading')}</div>
      </div>
    );
  }

  const totalTokens = (summary?.totalInputTokens || 0) + (summary?.totalOutputTokens || 0);

  return (
    <div className="h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="flex h-16 items-center justify-between border-b bg-white px-6">
        <h1 className="text-xl font-semibold text-gray-800">{t('usage.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchUsage}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('usage.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('json')}>
            <Download className="mr-2 h-4 w-4" />
            JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsCleanupDialogOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('usage.cleanup')}
          </Button>
        </div>
      </header>

      <main className="p-6 overflow-auto h-[calc(100vh-4rem)]">
        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{t('usage.filters')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-2">
                <Label>{t('usage.start_date')}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('usage.end_date')}</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('usage.provider')}</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder={t('usage.all_providers')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t('usage.all_providers')}</SelectItem>
                    {filters?.providers.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('usage.model')}</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder={t('usage.all_models')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t('usage.all_models')}</SelectItem>
                    {filters?.models.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {summary && summary.totalRequests > 0 ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.total_requests')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatNumber(summary.totalRequests)}</div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(summary.successRequests)} {t('usage.success')} / {formatNumber(summary.failedRequests)} {t('usage.failed')}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.input_tokens')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {formatTokens(summary.totalInputTokens)}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatNumber(summary.totalInputTokens)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.output_tokens')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {formatTokens(summary.totalOutputTokens)}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatNumber(summary.totalOutputTokens)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('usage.total_tokens')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatTokens(totalTokens)}</div>
                  <p className="text-xs text-muted-foreground">{formatNumber(totalTokens)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Provider and Model Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* By Provider */}
              {summary.byProvider && summary.byProvider.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Zap className="h-5 w-5" />
                      {t('usage.by_provider')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {summary.byProvider.map((p) => (
                        <div key={p.provider} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <div className="font-medium">{p.provider}</div>
                            <div className="text-sm text-muted-foreground">
                              {formatNumber(p.requests)} {t('usage.requests')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{formatTokens(p.inputTokens + p.outputTokens)}</div>
                            <div className="text-sm text-muted-foreground">{t('usage.tokens')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* By Model */}
              {summary.byModel && summary.byModel.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      {t('usage.by_model')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {summary.byModel.slice(0, 10).map((m) => (
                        <div key={`${m.provider}-${m.model}`} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <div className="font-medium">{m.model}</div>
                            <div className="text-sm text-muted-foreground">
                              {m.provider} · {formatNumber(m.requests)} {t('usage.requests')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{formatTokens(m.inputTokens + m.outputTokens)}</div>
                            <div className="text-sm text-muted-foreground">{t('usage.tokens')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Recent Records */}
            {records.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    {t('usage.recent_records')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">{t('usage.time')}</th>
                          <th className="text-left p-2">{t('usage.provider')}</th>
                          <th className="text-left p-2">{t('usage.model')}</th>
                          <th className="text-right p-2">{t('usage.input')}</th>
                          <th className="text-right p-2">{t('usage.output')}</th>
                          <th className="text-center p-2">{t('usage.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.slice(0, 20).map((record) => (
                          <tr key={record.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 text-sm">
                              {new Date(record.timestamp).toLocaleString()}
                            </td>
                            <td className="p-2">{record.provider}</td>
                            <td className="p-2">{record.model}</td>
                            <td className="p-2 text-right">{formatNumber(record.inputTokens)}</td>
                            <td className="p-2 text-right">{formatNumber(record.outputTokens)}</td>
                            <td className="p-2 text-center">
                              <span className={`inline-block px-2 py-1 rounded text-xs ${
                                record.success
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {record.success ? t('usage.success') : t('usage.failed')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-500 text-lg">{t('usage.no_data')}</p>
              <p className="text-gray-400 text-sm">{t('usage.no_data_hint')}</p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Cleanup Dialog */}
      <Dialog open={isCleanupDialogOpen} onOpenChange={setIsCleanupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('usage.cleanup_title')}</DialogTitle>
            <DialogDescription>{t('usage.cleanup_description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('usage.retention_days')}</Label>
              <Input
                type="number"
                value={cleanupRetentionDays}
                onChange={(e) => setCleanupRetentionDays(parseInt(e.target.value) || 90)}
              />
              <p className="text-sm text-muted-foreground">{t('usage.retention_days_hint')}</p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="dryRun"
                checked={cleanupDryRun}
                onChange={(e) => setCleanupDryRun(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="dryRun">{t('usage.dry_run')}</Label>
            </div>

            {cleanupResult && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="font-medium mb-2">
                  {cleanupDryRun ? t('usage.dry_run_result') : t('usage.cleanup_result')}
                </p>
                <p>{t('usage.records_deleted', { count: cleanupResult.deletedCount })}</p>
                <p>{t('usage.space_freed', { size: formatBytes(cleanupResult.freedBytes) })}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCleanupDialogOpen(false)}>
              {t('usage.cancel')}
            </Button>
            <Button onClick={handleCleanup}>
              {cleanupDryRun ? t('usage.preview') : t('usage.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}