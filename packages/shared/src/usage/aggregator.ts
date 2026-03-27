/**
 * Usage aggregator - handles statistical aggregation of usage data
 */

import type {
  UsageRecord,
  UsageQuery,
  AggregatedUsage,
  ProviderStats,
  ModelStats,
  DailyUsageSummary,
  HourlyStats,
  HourlyAggregation,
  PerformanceMetrics,
} from './types';
import { query, listMonthlyFiles, readMonthlyFile } from './storage';

/**
 * Performance tracking helper
 */
interface PerformanceAccumulator {
  durationSum: number;
  durationCount: number;
  ttftSum: number;
  ttftCount: number;
  speedSum: number;
  speedCount: number;
}

function createPerformanceAccumulator(): PerformanceAccumulator {
  return {
    durationSum: 0,
    durationCount: 0,
    ttftSum: 0,
    ttftCount: 0,
    speedSum: 0,
    speedCount: 0,
  };
}

function addRecordPerformance(acc: PerformanceAccumulator, record: UsageRecord): void {
  const outputDuration = Math.max(0, (record.duration || 0) - (record.timeToFirstToken || 0));
  if (outputDuration > 0) {
    acc.durationSum += outputDuration;
    acc.durationCount++;

    // Calculate speed: tokens per second (using output duration = total duration - TTFT)
    const outputTokens = record.outputTokens || 0;
    if (outputTokens > 0) {
      const outputDurationSeconds = outputDuration / 1000;
      acc.speedSum += outputTokens / outputDurationSeconds;
      acc.speedCount++;
    }
  }

  if (record.timeToFirstToken && record.timeToFirstToken > 0) {
    acc.ttftSum += record.timeToFirstToken;
    acc.ttftCount++;
  }
}

function calculatePerformance(acc: PerformanceAccumulator): {
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
} {
  const result: {
    avgLatency?: number;
    avgTimeToFirstToken?: number;
    avgSpeed?: number;
  } = {};

  if (acc.durationCount > 0) {
    result.avgLatency = Math.round(acc.durationSum / acc.durationCount);
  }

  if (acc.ttftCount > 0) {
    result.avgTimeToFirstToken = Math.round(acc.ttftSum / acc.ttftCount);
  }

  if (acc.speedCount > 0) {
    result.avgSpeed = Math.round(acc.speedSum / acc.speedCount);
  }

  return result;
}

/**
 * Create empty hourly stats
 */
function createEmptyHourlyStats(): HourlyStats[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    requests: 0,
    successRequests: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  }));
}

/**
 * Aggregate usage statistics
 */
export function aggregate(queryParams: UsageQuery): AggregatedUsage {
  const records = queryParams.limit ? query({ ...queryParams, limit: undefined }) : query(queryParams);

  // Determine date range
  let startDate = queryParams.startDate;
  let endDate = queryParams.endDate;

  if (!startDate || !endDate) {
    const dates = records.map(r => r.date);
    if (dates.length > 0) {
      dates.sort();
      if (!startDate) startDate = dates[0];
      if (!endDate) endDate = dates[dates.length - 1];
    } else {
      const today = new Date().toISOString().split('T')[0];
      if (!startDate) startDate = today;
      if (!endDate) endDate = today;
    }
  }

  // Initialize result with performance accumulator
  const result: AggregatedUsage = {
    startDate,
    endDate,
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalReasoningTokens: 0,
  };

  // Global performance accumulator
  const globalPerf = createPerformanceAccumulator();

  // Aggregation maps
  const providerMap = new Map<string, ProviderStats & { _perf: PerformanceAccumulator }>();
  const modelMap = new Map<string, ModelStats & { _perf: PerformanceAccumulator }>();
  const dateMap = new Map<string, Map<string, Map<string, DailyUsageSummary & { _perf: PerformanceAccumulator }>>>();
  // Track hourly performance by date -> provider -> model -> hour -> perf
  const hourlyPerfMap = new Map<string, Map<string, Map<string, Map<number, PerformanceAccumulator>>>>();

  // Process records
  for (const record of records) {
    // Totals
    result.totalRequests++;
    if (record.success) {
      result.successRequests++;
    } else {
      result.failedRequests++;
    }
    result.totalInputTokens += record.inputTokens || 0;
    result.totalOutputTokens += record.outputTokens || 0;
    result.totalCacheCreationTokens += record.cacheCreationInputTokens || 0;
    result.totalCacheReadTokens += record.cacheReadInputTokens || 0;
    result.totalReasoningTokens += record.reasoningTokens || 0;

    // Global performance
    addRecordPerformance(globalPerf, record);

    // By provider
    let providerStats = providerMap.get(record.provider);
    if (!providerStats) {
      providerStats = {
        provider: record.provider,
        requests: 0,
        successRequests: 0,
        failedRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        models: [],
        _perf: createPerformanceAccumulator(),
      };
      providerMap.set(record.provider, providerStats);
    }
    providerStats.requests++;
    if (record.success) providerStats.successRequests++;
    else providerStats.failedRequests++;
    providerStats.inputTokens += record.inputTokens || 0;
    providerStats.outputTokens += record.outputTokens || 0;
    providerStats.cacheCreationTokens += record.cacheCreationInputTokens || 0;
    providerStats.cacheReadTokens += record.cacheReadInputTokens || 0;
    providerStats.reasoningTokens += record.reasoningTokens || 0;
    addRecordPerformance(providerStats._perf, record);

    // By model
    // Normalize model to string (handle both string and array)
    const modelStr = Array.isArray(record.model) ? record.model.join(',') : String(record.model);
    const modelKey = `${record.provider}/${modelStr}`;
    let modelStats = modelMap.get(modelKey);
    if (!modelStats) {
      modelStats = {
        model: record.model,
        provider: record.provider,
        requests: 0,
        successRequests: 0,
        failedRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        _perf: createPerformanceAccumulator(),
      };
      modelMap.set(modelKey, modelStats);
    }
    modelStats.requests++;
    if (record.success) modelStats.successRequests++;
    else modelStats.failedRequests++;
    modelStats.inputTokens += record.inputTokens || 0;
    modelStats.outputTokens += record.outputTokens || 0;
    modelStats.cacheCreationTokens += record.cacheCreationInputTokens || 0;
    modelStats.cacheReadTokens += record.cacheReadInputTokens || 0;
    modelStats.reasoningTokens += record.reasoningTokens || 0;
    addRecordPerformance(modelStats._perf, record);

    // Update provider's models list
    // Compare using normalized string (handle both string and array)
    const existingModel = providerStats.models.find(m => {
      const mStr = Array.isArray(m.model) ? m.model.join(',') : String(m.model);
      return mStr === modelStr;
    });
    if (!existingModel) {
      providerStats.models.push(modelStats);
    }

    // By date -> provider -> model
    let dateEntry = dateMap.get(record.date);
    if (!dateEntry) {
      dateEntry = new Map();
      dateMap.set(record.date, dateEntry);
    }
    let providerEntry = dateEntry.get(record.provider);
    if (!providerEntry) {
      providerEntry = new Map();
      dateEntry.set(record.provider, providerEntry);
    }
    let dailySummary = providerEntry.get(record.model);
    if (!dailySummary) {
      dailySummary = {
        date: record.date,
        provider: record.provider,
        model: record.model,
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalReasoningTokens: 0,
        hourlyBreakdown: createEmptyHourlyStats(),
        _perf: createPerformanceAccumulator(),
      };
      providerEntry.set(record.model, dailySummary);
    }

    // Update daily summary
    dailySummary.totalRequests++;
    if (record.success) dailySummary.successRequests++;
    else dailySummary.failedRequests++;
    dailySummary.totalInputTokens += record.inputTokens || 0;
    dailySummary.totalOutputTokens += record.outputTokens || 0;
    dailySummary.totalCacheCreationTokens += record.cacheCreationInputTokens || 0;
    dailySummary.totalCacheReadTokens += record.cacheReadInputTokens || 0;
    dailySummary.totalReasoningTokens += record.reasoningTokens || 0;
    addRecordPerformance(dailySummary._perf, record);

    // Update hourly breakdown
    const hour = new Date(record.timestamp).getHours();
    const hourlyStats = dailySummary.hourlyBreakdown[hour];
    hourlyStats.requests++;
    if (record.success) hourlyStats.successRequests++;
    else hourlyStats.failedRequests++;
    hourlyStats.inputTokens += record.inputTokens || 0;
    hourlyStats.outputTokens += record.outputTokens || 0;
    hourlyStats.cacheCreationTokens += record.cacheCreationInputTokens || 0;
    hourlyStats.cacheReadTokens += record.cacheReadInputTokens || 0;
    hourlyStats.reasoningTokens += record.reasoningTokens || 0;

    // Track hourly performance separately by provider and model
    if (!hourlyPerfMap.has(record.date)) {
      hourlyPerfMap.set(record.date, new Map());
    }
    const dateHourlyPerf = hourlyPerfMap.get(record.date)!;
    const providerKey = record.provider;
    if (!dateHourlyPerf.has(providerKey)) {
      dateHourlyPerf.set(providerKey, new Map());
    }
    const providerHourlyPerf = dateHourlyPerf.get(providerKey)!;
    // Use model as part of key (handle both string and array formats)
    const perfModelKey = Array.isArray(record.model) ? record.model.join(',') : String(record.model);
    if (!providerHourlyPerf.has(perfModelKey)) {
      providerHourlyPerf.set(perfModelKey, new Map());
    }
    const modelHourlyPerf = providerHourlyPerf.get(perfModelKey)!;
    if (!modelHourlyPerf.has(hour)) {
      modelHourlyPerf.set(hour, createPerformanceAccumulator());
    }
    addRecordPerformance(modelHourlyPerf.get(hour)!, record);
  }

  // Calculate global performance metrics
  const globalPerformance = calculatePerformance(globalPerf);
  result.avgLatency = globalPerformance.avgLatency;
  result.avgTimeToFirstToken = globalPerformance.avgTimeToFirstToken;
  result.avgSpeed = globalPerformance.avgSpeed;

  // Calculate cache hit ratio
  const totalInput = result.totalInputTokens + result.totalCacheReadTokens;
  if (totalInput > 0) {
    result.cacheHitRatio = result.totalCacheReadTokens / totalInput;
  }

  // Set grouped results with performance metrics
  result.byProvider = Array.from(providerMap.values()).map(p => {
    const perf = calculatePerformance(p._perf);
    const { _perf, ...stats } = p;
    return { ...stats, ...perf };
  }).sort((a, b) => b.requests - a.requests);

  result.byModel = Array.from(modelMap.values()).map(m => {
    const perf = calculatePerformance(m._perf);
    const { _perf, ...stats } = m;
    return { ...stats, ...perf };
  }).sort((a, b) => b.requests - a.requests);

  // Flatten daily summaries with performance metrics
  const dailySummaries: DailyUsageSummary[] = [];
  for (const [, providerEntry] of dateMap) {
    for (const [, modelMap] of providerEntry) {
      for (const [, dailySummary] of modelMap) {
        const perf = calculatePerformance(dailySummary._perf);
        const { _perf, ...summary } = dailySummary;

        // Calculate hourly performance (now properly separated by provider and model)
        const dateHourlyPerf = hourlyPerfMap.get(summary.date);
        if (dateHourlyPerf) {
          // Get provider-specific hourly perf
          const providerHourlyPerf = dateHourlyPerf.get(summary.provider);
          if (providerHourlyPerf) {
            // Get model-specific hourly perf (handle both string and array formats)
            const perfModelKey2 = Array.isArray(summary.model) ? summary.model.join(',') : String(summary.model);
            const modelHourlyPerf = providerHourlyPerf.get(perfModelKey2);
            if (modelHourlyPerf) {
              for (const hourlyStat of summary.hourlyBreakdown) {
                const hourPerf = modelHourlyPerf.get(hourlyStat.hour);
                if (hourPerf) {
                  const hourPerformance = calculatePerformance(hourPerf);
                  // Only assign if the value exists (not undefined)
                  if (hourPerformance.avgLatency !== undefined) {
                    hourlyStat.avgLatency = hourPerformance.avgLatency;
                  }
                  if (hourPerformance.avgTimeToFirstToken !== undefined) {
                    hourlyStat.avgTimeToFirstToken = hourPerformance.avgTimeToFirstToken;
                  }
                  if (hourPerformance.avgSpeed !== undefined) {
                    hourlyStat.avgSpeed = hourPerformance.avgSpeed;
                  }
                }
              }
            }
          }
        }

        dailySummaries.push({ ...summary, ...perf });
      }
    }
  }
  result.byDate = dailySummaries.sort((a, b) => {
    // Sort by date desc, then provider, then model
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    // Handle model being either string or array
    const aModel = Array.isArray(a.model) ? a.model.join(',') : String(a.model);
    const bModel = Array.isArray(b.model) ? b.model.join(',') : String(b.model);
    return aModel.localeCompare(bModel);
  });

  return result;
}

/**
 * Get today's usage summary
 */
export function getTodaySummary(): AggregatedUsage {
  const today = new Date().toISOString().split('T')[0];
  return aggregate({ startDate: today, endDate: today });
}

/**
 * Get usage summary for a specific date
 */
export function getDateSummary(date: string): AggregatedUsage {
  return aggregate({ startDate: date, endDate: date });
}

/**
 * Get usage summary for a date range
 */
export function getDateRangeSummary(startDate: string, endDate: string): AggregatedUsage {
  return aggregate({ startDate, endDate });
}

/**
 * Format token count for display
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  return tokens.toString();
}

/**
 * Format number with locale separators
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Get available date range in the data
 */
export function getAvailableDateRange(): { startDate: string; endDate: string } | null {
  const files = listMonthlyFiles();
  if (files.length === 0) {
    return null;
  }

  let minDate = '';
  let maxDate = '';

  for (const file of files) {
    for (const record of readMonthlyFile(file)) {
      if (!minDate || record.date < minDate) minDate = record.date;
      if (!maxDate || record.date > maxDate) maxDate = record.date;
    }
  }

  if (!minDate || !maxDate) {
    return null;
  }

  return { startDate: minDate, endDate: maxDate };
}

/**
 * Get daily totals (aggregated across all providers/models)
 */
export function getDailyTotals(startDate: string, endDate: string): Array<{
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}> {
  const aggregated = aggregate({ startDate, endDate });

  // Group by date
  const dateTotals = new Map<string, {
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>();

  for (const daily of aggregated.byDate || []) {
    let entry = dateTotals.get(daily.date);
    if (!entry) {
      entry = {
        date: daily.date,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      dateTotals.set(daily.date, entry);
    }
    entry.requests += daily.totalRequests;
    entry.inputTokens += daily.totalInputTokens;
    entry.outputTokens += daily.totalOutputTokens;
    entry.totalTokens += daily.totalInputTokens + daily.totalOutputTokens;
  }

  return Array.from(dateTotals.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

/**
 * Get hourly aggregation across date range
 * @param provider - Filter by provider name (optional)
 * @param model - Filter by model name (optional)
 */
export function getHourlyAggregation(startDate: string, endDate: string, provider?: string, model?: string): HourlyAggregation[] {
  const aggregated = aggregate({ startDate, endDate });

  // Initialize 24 hours
  const hourlyData: HourlyAggregation[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  }));

  // Accumulate from daily summaries, applying provider/model filters
  for (const daily of aggregated.byDate || []) {
    // Apply provider filter
    if (provider && daily.provider !== provider) continue;
    // Apply model filter
    if (model) {
      const dailyModelStr = Array.isArray(daily.model) ? daily.model.join(',') : String(daily.model);
      const filterModelStr = Array.isArray(model) ? model.join(',') : String(model);
      if (dailyModelStr !== filterModelStr) continue;
    }

    for (const hourly of daily.hourlyBreakdown) {
      const data = hourlyData[hourly.hour];
      data.requests += hourly.requests;
      data.inputTokens += hourly.inputTokens;
      data.outputTokens += hourly.outputTokens;
      data.cacheCreationTokens += hourly.cacheCreationTokens;
      data.cacheReadTokens += hourly.cacheReadTokens;

      // Calculate performance metrics
      if (hourly.avgLatency) {
        // Weighted average by requests
        const existingWeight = data.requests - hourly.requests;
        const newWeight = hourly.requests;
        if (data.avgLatency === undefined) {
          data.avgLatency = hourly.avgLatency;
        } else {
          data.avgLatency = Math.round(
            (data.avgLatency * existingWeight + hourly.avgLatency * newWeight) / data.requests
          );
        }
      }

      if (hourly.avgSpeed) {
        const existingWeight = data.requests - hourly.requests;
        const newWeight = hourly.requests;
        if (data.avgSpeed === undefined) {
          data.avgSpeed = hourly.avgSpeed;
        } else {
          data.avgSpeed = Math.round(
            (data.avgSpeed * existingWeight + hourly.avgSpeed * newWeight) / data.requests
          );
        }
      }
    }
  }

  return hourlyData;
}

/**
 * Get performance metrics time series data
 */
export function getPerformanceMetrics(
  startDate: string,
  endDate: string,
  groupBy: 'day' | 'hour' = 'day',
  provider?: string,
  model?: string
): PerformanceMetrics[] {
  const aggregated = aggregate({ startDate, endDate, provider, model });
  const metrics: PerformanceMetrics[] = [];

  if (groupBy === 'day') {
    // Group by date
    for (const daily of aggregated.byDate || []) {
      metrics.push({
        timestamp: daily.date,
        date: daily.date,
        provider: daily.provider,
        model: Array.isArray(daily.model) ? daily.model.join(',') : String(daily.model),
        requests: daily.totalRequests,
        inputTokens: daily.totalInputTokens,
        outputTokens: daily.totalOutputTokens,
        avgLatency: daily.avgLatency,
        avgTimeToFirstToken: daily.avgTimeToFirstToken,
        avgSpeed: daily.avgSpeed,
      });
    }
  } else {
    // Group by hour within each date
    for (const daily of aggregated.byDate || []) {
      for (const hourly of daily.hourlyBreakdown) {
        if (hourly.requests > 0) {
          const timestamp = `${daily.date}T${hourly.hour.toString().padStart(2, '0')}:00:00`;
          metrics.push({
            timestamp,
            date: daily.date,
            provider: daily.provider,
            model: Array.isArray(daily.model) ? daily.model.join(',') : String(daily.model),
            requests: hourly.requests,
            inputTokens: hourly.inputTokens,
            outputTokens: hourly.outputTokens,
            avgLatency: hourly.avgLatency,
            avgSpeed: hourly.avgSpeed,
          });
        }
      }
    }
  }

  return metrics.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
