import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import os from 'os';

const LOGS_DIR = path.join(os.homedir(), '.claude-code-router', 'logs');

export interface LogSearchResult {
  requestId: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Search recent log files for a request body entry matching the given requestId.
 * Searches up to 7 days of log files (ccr-*.log).
 * Stops at first match. Does NOT load entire files into memory.
 */
export async function searchRequestBodyFromLogs(requestId: string): Promise<LogSearchResult | null> {
  const DAYS_BACK = 7;
  const now = new Date();

  for (let i = 0; i < DAYS_BACK; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const logFiles = getLogFilesForDate(date);
    for (const file of logFiles) {
      const result = await searchFileForRequestId(file, requestId);
      if (result) return result;
    }
  }

  return null;
}

function getLogFilesForDate(date: Date): string[] {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const logsDir = LOGS_DIR;

  if (!fs.existsSync(logsDir)) return [];

  try {
    return fs.readdirSync(logsDir)
      .filter(f => f.startsWith(`ccr-${year}${month}${day}`))
      .map(f => path.join(logsDir, f));
  } catch {
    return [];
  }
}

async function searchFileForRequestId(filePath: string, requestId: string): Promise<LogSearchResult | null> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      try {
        const entry = JSON.parse(line);
        if (entry.reqId === requestId && entry.type === 'request body' && entry.data) {
          rl.close();
          stream.destroy();
          resolve({ requestId, data: entry.data, timestamp: entry.time as string | undefined });
        }
      } catch {
        // Not a JSON line, skip
      }
    });

    rl.on('close', () => resolve(null));
    stream.on('error', () => resolve(null));
  });
}
