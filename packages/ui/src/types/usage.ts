/**
 * Shared UsageRecord type for UI components.
 * Aligned with packages/shared/src/usage/types.ts.
 */
export interface UsageRecord {
  id: string;
  requestId: string;
  timestamp: string;
  date: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  duration?: number;
  timeToFirstToken?: number;
  success: boolean;
  errorMessage?: string;
  reasoningTokens?: number;
}
