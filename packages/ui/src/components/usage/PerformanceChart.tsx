import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from '@/components/ui/chart';
import { CHART_COLORS } from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { TrendingUp, Clock } from 'lucide-react';

interface PerformanceData {
  timestamp: string;
  date: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
}

interface PerformanceChartProps {
  data: PerformanceData[];
  providers: string[];
  loading?: boolean;
}

type MetricType = 'speed' | 'latency';

export function PerformanceChart({ data, providers, loading }: PerformanceChartProps) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<MetricType>('speed');

  // Group data by provider and aggregate by date
  const chartData = useMemo(() => {
    const dateMap = new Map<string, { [provider: string]: number }>();

    for (const item of data) {
      const date = item.date;
      if (!dateMap.has(date)) {
        dateMap.set(date, {});
      }

      const providerData = dateMap.get(date)!;
      const existingValue = providerData[item.provider] || 0;
      const value = metric === 'speed' ? (item.avgSpeed || 0) : (item.avgLatency || 0);

      // Weighted average by requests
      const existingWeight = Object.keys(providerData).length;
      const totalWeight = existingWeight + item.requests;
      providerData[item.provider] = existingWeight === 0
        ? value
        : (existingValue * existingWeight + value * item.requests) / totalWeight;
    }

    return Array.from(dateMap.entries())
      .map(([date, values]) => ({
        date,
        ...values,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data, metric]);

  // Get visible providers (those with data)
  const visibleProviders = useMemo(() => {
    const providersWithData = new Set<string>();
    for (const item of data) {
      if ((metric === 'speed' && item.avgSpeed) || (metric === 'latency' && item.avgLatency)) {
        providersWithData.add(item.provider);
      }
    }
    return providers.filter(p => providersWithData.has(p));
  }, [data, providers, metric]);

  const formatValue = (value: number) => {
    if (metric === 'speed') {
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
      return Math.round(value).toString();
    } else {
      if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
      return Math.round(value).toString();
    }
  };

  const formatYAxis = (value: number) => {
    if (metric === 'speed') {
      return value >= 1000 ? `${(value / 1000).toFixed(0)}K` : value.toString();
    } else {
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (chartData.length === 0 || visibleProviders.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground h-64 flex items-center justify-center">
        {t('usage.no_performance_data')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Metric Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('usage.metric')}:</span>
        <Button
          variant={metric === 'speed' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMetric('speed')}
          className="gap-1"
        >
          <TrendingUp className="w-4 h-4" />
          {t('usage.speed')}
        </Button>
        <Button
          variant={metric === 'latency' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMetric('latency')}
          className="gap-1"
        >
          <Clock className="w-4 h-4" />
          {t('usage.latency')}
        </Button>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tickFormatter={(date) => {
                const d = new Date(date);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
              stroke="#6b7280"
              fontSize={12}
            />
            <YAxis
              tickFormatter={formatYAxis}
              stroke="#6b7280"
              fontSize={12}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              labelStyle={{ color: '#374151' }}
              formatter={(value: any, name: any) => [
                `${formatValue(Number(value) || 0)} ${metric === 'speed' ? 'tokens/s' : ''}`,
                name,
              ]}
              labelFormatter={(label) => {
                const d = new Date(label);
                return d.toLocaleDateString();
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
            />
            {visibleProviders.map((provider, index) => (
              <Line
                key={provider}
                type="monotone"
                dataKey={provider}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend note */}
      <div className="text-xs text-muted-foreground text-center">
        {metric === 'speed'
          ? t('usage.speed_description')
          : t('usage.latency_description')}
      </div>
    </div>
  );
}
