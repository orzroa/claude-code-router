import { useTranslation } from 'react-i18next';

// Local format tokens function
function formatTokens(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

interface HourlyData {
  hour: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  avgLatency?: number;
  avgSpeed?: number;
}

interface HourlyTableProps {
  data: HourlyData[];
  loading?: boolean;
}

export function HourlyTable({ data, loading }: HourlyTableProps) {
  const { t } = useTranslation();

  const formatLatency = (ms?: number) => {
    if (!ms) return '-';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
  };

  const formatSpeed = (speed?: number) => {
    if (!speed) return '-';
    if (speed >= 1000) return `${(speed / 1000).toFixed(1)}K/s`;
    return `${Math.round(speed)}/s`;
  };

  const formatHour = (hour: number) => {
    return `${hour.toString().padStart(2, '0')}:00 - ${hour.toString().padStart(2, '0')}:59`;
  };

  const getIntensityColor = (value: number, max: number) => {
    const ratio = max > 0 ? value / max : 0;
    if (ratio > 0.7) return 'bg-blue-500/20';
    if (ratio > 0.4) return 'bg-blue-500/10';
    if (ratio > 0.1) return 'bg-blue-500/5';
    return '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Find max values for intensity coloring
  const maxRequests = Math.max(...data.map(d => d.requests), 0);
  const maxTokens = Math.max(...data.map(d => d.inputTokens + d.outputTokens), 0);

  // Calculate totals
  const totals = data.reduce((acc, item) => ({
    requests: acc.requests + item.requests,
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
  }), { requests: 0, inputTokens: 0, outputTokens: 0 });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-2 text-left">{t('usage.hour')}</th>
            <th className="p-2 text-right">{t('usage.requests')}</th>
            <th className="p-2 text-right">{t('usage.input_tokens')}</th>
            <th className="p-2 text-right">{t('usage.output_tokens')}</th>
            <th className="p-2 text-right">{t('usage.avg_latency')}</th>
            <th className="p-2 text-right">{t('usage.avg_speed')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={item.hour}
              className={`border-b hover:bg-muted/30 transition-colors ${getIntensityColor(item.requests, maxRequests)}`}
            >
              <td className="p-2 font-mono text-sm">{formatHour(item.hour)}</td>
              <td className="p-2 text-right">{item.requests.toLocaleString()}</td>
              <td className="p-2 text-right font-mono">{formatTokens(item.inputTokens)}</td>
              <td className="p-2 text-right font-mono">{formatTokens(item.outputTokens)}</td>
              <td className="p-2 text-right">
                <span className={item.avgLatency && item.avgLatency > 5000 ? 'text-red-500' : 'text-green-600'}>
                  {formatLatency(item.avgLatency)}
                </span>
              </td>
              <td className="p-2 text-right">
                <span className={item.avgSpeed && item.avgSpeed < 10 ? 'text-red-500' : 'text-green-600'}>
                  {formatSpeed(item.avgSpeed)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-muted font-semibold bg-muted/30">
            <td className="p-2">{t('usage.total')}</td>
            <td className="p-2 text-right">{totals.requests.toLocaleString()}</td>
            <td className="p-2 text-right font-mono">{formatTokens(totals.inputTokens)}</td>
            <td className="p-2 text-right font-mono">{formatTokens(totals.outputTokens)}</td>
            <td className="p-2 text-right">-</td>
            <td className="p-2 text-right">-</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
