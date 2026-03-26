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
} from './types';
import { query, listMonthlyFiles, readMonthlyFile } from './storage';

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

  // Initialize result
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

  // Aggregation maps
  const providerMap = new Map<string, ProviderStats>();
  const modelMap = new Map<string, ModelStats>();
  const dateMap = new Map<string, Map<string, Map<string, DailyUsageSummary>>>();

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

    // By model
    const modelKey = `${record.provider}/${record.model}`;
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

    // Update provider's models list
    if (!providerStats.models.find(m => m.model === record.model)) {
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
  }

  // Set grouped results
  result.byProvider = Array.from(providerMap.values()).sort((a, b) =>
    b.requests - a.requests
  );
  result.byModel = Array.from(modelMap.values()).sort((a, b) =>
    b.requests - a.requests
  );

  // Flatten daily summaries
  const dailySummaries: DailyUsageSummary[] = [];
  for (const [, providerEntry] of dateMap) {
    for (const [, modelMap] of providerEntry) {
      for (const [, dailySummary] of modelMap) {
        dailySummaries.push(dailySummary);
      }
    }
  }
  result.byDate = dailySummaries.sort((a, b) => {
    // Sort by date desc, then provider, then model
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.model.localeCompare(b.model);
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