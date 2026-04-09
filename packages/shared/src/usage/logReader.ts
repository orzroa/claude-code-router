import * as fs from 'fs';
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
 * Searches up to 7 days of log files (ccr-*.log) by modification time.
 * Stops at first match. Uses a custom newline splitter to handle entries
 * that may span multiple lines (e.g. message content with embedded newlines).
 */
export async function searchRequestBodyFromLogs(requestId: string): Promise<LogSearchResult | null> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  if (!fs.existsSync(LOGS_DIR)) return null;

  let logFiles: string[] = [];
  try {
    logFiles = fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('ccr-') && f.endsWith('.log'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOGS_DIR, f)).mtimeMs }))
      .filter(f => f.mtime >= cutoff)
      .sort((a, b) => b.mtime - a.mtime)
      .map(f => path.join(LOGS_DIR, f.name));
  } catch {
    return null;
  }

  for (const file of logFiles) {
    const result = await searchFileForRequestId(file, requestId);
    if (result) return result;
  }

  return null;
}

async function searchFileForRequestId(filePath: string, requestId: string): Promise<LogSearchResult | null> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
      highWaterMark: 1024 * 1024, // 1MB chunks
    });

    let leftover = ''; // partial line from previous chunk
    let closed = false;

    stream.on('data', (chunk) => {
      if (closed) return;

      // Prepend any leftover from previous chunk
      const data = leftover + chunk;
      const lines = data.split('\n');

      // Last element may be incomplete — save for next chunk
      leftover = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.reqId === requestId && entry.type === 'request body' && entry.data) {
            stream.destroy();
            closed = true;
            resolve({ requestId, data: entry.data, timestamp: entry.time as string | undefined });
            return;
          }
        } catch {
          // Skip malformed lines
        }
      }
    });

    stream.on('close', () => {
      if (closed) return;
      // Process any remaining data
      if (leftover.trim()) {
        try {
          const entry = JSON.parse(leftover);
          if (entry.reqId === requestId && entry.type === 'request body' && entry.data) {
            resolve({ requestId, data: entry.data, timestamp: entry.time as string | undefined });
            return;
          }
        } catch {
          // Skip
        }
      }
      resolve(null);
    });

    stream.on('error', () => resolve(null));
  });
}
