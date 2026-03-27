/**
 * Usage storage - handles persistent storage of usage records
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HOME_DIR } from '../constants';
import type {
  UsageRecord,
  UsageQuery,
  CleanupOptions,
  CleanupResult,
} from './types';

// Storage directory
export const USAGE_DIR = path.join(HOME_DIR, 'usage');

// Monthly file pattern: usage-YYYY-MM.jsonl
const MONTHLY_FILE_PATTERN = /^usage-(\d{4}-\d{2})\.jsonl$/;

/**
 * Ensure the usage directory exists
 */
function ensureUsageDir(): void {
  if (!fs.existsSync(USAGE_DIR)) {
    fs.mkdirSync(USAGE_DIR, { recursive: true });
  }
}

/**
 * Get the monthly file path for a given date
 */
function getMonthlyFilePath(date: string): string {
  // date is YYYY-MM-DD, extract YYYY-MM
  const month = date.substring(0, 7);
  return path.join(USAGE_DIR, `usage-${month}.jsonl`);
}

/**
 * Generate a unique ID for a usage record
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Append a usage record to storage
 */
export function append(record: Omit<UsageRecord, 'id'>): UsageRecord {
  ensureUsageDir();

  const fullRecord: UsageRecord = {
    id: generateId(),
    ...record,
  };

  const filePath = getMonthlyFilePath(record.date);
  const line = JSON.stringify(fullRecord) + '\n';

  fs.appendFileSync(filePath, line, 'utf-8');

  return fullRecord;
}

/**
 * Append a usage record asynchronously
 */
export async function appendAsync(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
  ensureUsageDir();

  const fullRecord: UsageRecord = {
    id: generateId(),
    ...record,
  };

  const filePath = getMonthlyFilePath(record.date);
  const line = JSON.stringify(fullRecord) + '\n';

  await fs.promises.appendFile(filePath, line, 'utf-8');

  return fullRecord;
}

/**
 * List all monthly files
 */
export function listMonthlyFiles(): string[] {
  ensureUsageDir();

  const files = fs.readdirSync(USAGE_DIR);
  return files
    .filter(f => MONTHLY_FILE_PATTERN.test(f))
    .sort()
    .map(f => path.join(USAGE_DIR, f));
}

/**
 * Parse a monthly file and yield records
 */
export function* readMonthlyFile(filePath: string): Generator<UsageRecord> {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as UsageRecord;
    } catch {
      // Skip malformed lines
    }
  }
}

/**
 * Parse a monthly file asynchronously
 */
async function* readMonthlyFileAsync(filePath: string): AsyncGenerator<UsageRecord> {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as UsageRecord;
    } catch {
      // Skip malformed lines
    }
  }
}

/**
 * Query usage records
 */
export function query(query: UsageQuery): UsageRecord[] {
  const files = listMonthlyFiles();
  const records: UsageRecord[] = [];

  // Filter files by date range
  const startDate = query.startDate?.substring(0, 7) || '';
  const endDate = query.endDate?.substring(0, 7) || '';

  const relevantFiles = files.filter(f => {
    const match = path.basename(f).match(MONTHLY_FILE_PATTERN);
    if (!match) return false;
    const month = match[1];
    if (startDate && month < startDate) return false;
    if (endDate && month > endDate) return false;
    return true;
  });

  for (const file of relevantFiles) {
    for (const record of readMonthlyFile(file)) {
      // Apply filters
      if (query.startDate && record.date < query.startDate) continue;
      if (query.endDate && record.date > query.endDate) continue;
      if (query.provider && record.provider !== query.provider) continue;
      if (query.model && record.model !== query.model) continue;

      records.push(record);
    }
  }

  // Sort by timestamp descending
  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply pagination
  const offset = query.offset || 0;
  const limit = query.limit || records.length;

  return records.slice(offset, offset + limit);
}

/**
 * Query usage records asynchronously
 */
export async function* queryAsync(query: UsageQuery): AsyncGenerator<UsageRecord> {
  const files = listMonthlyFiles();

  // Filter files by date range
  const startDate = query.startDate?.substring(0, 7) || '';
  const endDate = query.endDate?.substring(0, 7) || '';

  const relevantFiles = files.filter(f => {
    const match = path.basename(f).match(MONTHLY_FILE_PATTERN);
    if (!match) return false;
    const month = match[1];
    if (startDate && month < startDate) return false;
    if (endDate && month > endDate) return false;
    return true;
  });

  let count = 0;
  const offset = query.offset || 0;
  const limit = query.limit || Infinity;

  for (const file of relevantFiles) {
    for await (const record of readMonthlyFileAsync(file)) {
      // Apply filters
      if (query.startDate && record.date < query.startDate) continue;
      if (query.endDate && record.date > query.endDate) continue;
      if (query.provider && record.provider !== query.provider) continue;
      if (query.model && record.model !== query.model) continue;

      count++;

      // Skip offset
      if (count <= offset) continue;

      // Stop at limit
      if (count > offset + limit) return;

      yield record;
    }
  }
}

/**
 * Get count of records matching query
 */
export function count(query: UsageQuery): number {
  const files = listMonthlyFiles();
  let total = 0;

  // Filter files by date range
  const startDate = query.startDate?.substring(0, 7) || '';
  const endDate = query.endDate?.substring(0, 7) || '';

  const relevantFiles = files.filter(f => {
    const match = path.basename(f).match(MONTHLY_FILE_PATTERN);
    if (!match) return false;
    const month = match[1];
    if (startDate && month < startDate) return false;
    if (endDate && month > endDate) return false;
    return true;
  });

  for (const file of relevantFiles) {
    for (const record of readMonthlyFile(file)) {
      // Apply filters
      if (query.startDate && record.date < query.startDate) continue;
      if (query.endDate && record.date > query.endDate) continue;
      if (query.provider && record.provider !== query.provider) continue;
      if (query.model && record.model !== query.model) continue;

      total++;
    }
  }

  return total;
}

/**
 * Cleanup old records
 */
export function cleanup(options: CleanupOptions): CleanupResult {
  const result: CleanupResult = {
    deletedCount: 0,
    deletedFiles: [],
    freedBytes: 0,
  };

  const files = listMonthlyFiles();

  // Calculate cutoff date
  let cutoffDate: string;
  if (options.beforeDate) {
    cutoffDate = options.beforeDate;
  } else if (options.retentionDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.retentionDays);
    cutoffDate = cutoff.toISOString().split('T')[0];
  } else {
    return result;
  }

  const cutoffMonth = cutoffDate.substring(0, 7);

  for (const file of files) {
    const match = path.basename(file).match(MONTHLY_FILE_PATTERN);
    if (!match) continue;

    const month = match[1];

    // If the entire month is before cutoff, delete the file
    if (month < cutoffMonth) {
      if (options.dryRun) {
        const stats = fs.statSync(file);
        result.deletedFiles.push(file);
        result.freedBytes += stats.size;
        // Count records
        for (const _ of readMonthlyFile(file)) {
          result.deletedCount++;
        }
      } else {
        const stats = fs.statSync(file);
        result.freedBytes += stats.size;

        // Count records before deleting
        for (const _ of readMonthlyFile(file)) {
          result.deletedCount++;
        }

        fs.unlinkSync(file);
        result.deletedFiles.push(file);
      }
    } else if (month === cutoffMonth) {
      // Need to filter records within the file
      const records: UsageRecord[] = [];
      let hasOldRecords = false;

      for (const record of readMonthlyFile(file)) {
        if (record.date < cutoffDate) {
          hasOldRecords = true;
          result.deletedCount++;
        } else {
          records.push(record);
        }
      }

      if (hasOldRecords && !options.dryRun) {
        // Rewrite the file without old records
        const content = records.map(r => JSON.stringify(r)).join('\n');
        if (content) {
          fs.writeFileSync(file, content + '\n', 'utf-8');
        } else {
          // All records deleted, remove the file
          fs.unlinkSync(file);
        }
        result.deletedFiles.push(file);
      }
    }
  }

  return result;
}

/**
 * Get unique providers in a date range
 */
export function getProviders(startDate?: string, endDate?: string): string[] {
  const providers = new Set<string>();
  const files = listMonthlyFiles();

  const startMonth = startDate?.substring(0, 7) || '';
  const endMonth = endDate?.substring(0, 7) || '';

  const relevantFiles = files.filter(f => {
    const match = path.basename(f).match(MONTHLY_FILE_PATTERN);
    if (!match) return false;
    const month = match[1];
    if (startMonth && month < startMonth) return false;
    if (endMonth && month > endMonth) return false;
    return true;
  });

  for (const file of relevantFiles) {
    for (const record of readMonthlyFile(file)) {
      if (startDate && record.date < startDate) continue;
      if (endDate && record.date > endDate) continue;
      providers.add(record.provider);
    }
  }

  return Array.from(providers).sort();
}

/**
 * Get unique models in a date range
 */
export function getModels(startDate?: string, endDate?: string): string[] {
  const models = new Set<string>();
  const files = listMonthlyFiles();

  const startMonth = startDate?.substring(0, 7) || '';
  const endMonth = endDate?.substring(0, 7) || '';

  const relevantFiles = files.filter(f => {
    const match = path.basename(f).match(MONTHLY_FILE_PATTERN);
    if (!match) return false;
    const month = match[1];
    if (startMonth && month < startMonth) return false;
    if (endMonth && month > endMonth) return false;
    return true;
  });

  for (const file of relevantFiles) {
    for (const record of readMonthlyFile(file)) {
      if (startDate && record.date < startDate) continue;
      if (endDate && record.date > endDate) continue;
      // Handle both string and array model formats
      if (Array.isArray(record.model)) {
        // If model is an array, add each item
        record.model.forEach(m => models.add(m));
      } else {
        models.add(record.model);
      }
    }
  }

  return Array.from(models).sort();
}