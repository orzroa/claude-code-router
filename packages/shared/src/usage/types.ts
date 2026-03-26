/**
 * Type definitions for token usage tracking
 */

/**
 * Single usage record
 */
export interface UsageRecord {
  id: string;                           // UUID
  timestamp: string;                    // ISO 8601
  date: string;                         // YYYY-MM-DD
  sessionId?: string;                   // Session identifier
  requestId: string;                    // Request identifier
  provider: string;                     // Provider name
  model: string;                        // Model name

  // Token usage
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;

  // Request metadata
  stream: boolean;
  success: boolean;
  errorMessage?: string;
  duration?: number;                    // Request duration in ms
  timeToFirstToken?: number;            // Time to first token in ms
}

/**
 * Hourly statistics
 */
export interface HourlyStats {
  hour: number;                         // 0-23
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

/**
 * Daily usage summary
 */
export interface DailyUsageSummary {
  date: string;                         // YYYY-MM-DD
  provider: string;
  model: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  hourlyBreakdown: HourlyStats[];
}

/**
 * Provider-level aggregated statistics
 */
export interface ProviderStats {
  provider: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  models: ModelStats[];
}

/**
 * Model-level aggregated statistics
 */
export interface ModelStats {
  model: string;
  provider: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

/**
 * Usage query parameters
 */
export interface UsageQuery {
  startDate?: string;                   // YYYY-MM-DD
  endDate?: string;                     // YYYY-MM-DD
  provider?: string;
  model?: string;
  groupBy?: 'date' | 'provider' | 'model' | 'hour';
  limit?: number;
  offset?: number;
}

/**
 * Aggregated usage result
 */
export interface AggregatedUsage {
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
  records?: UsageRecord[];
}

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Cleanup options
 */
export interface CleanupOptions {
  beforeDate?: string;                  // Delete records before this date
  retentionDays?: number;               // Keep records for N days
  dryRun?: boolean;                     // Preview without deleting
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  deletedCount: number;
  deletedFiles: string[];
  freedBytes: number;
}