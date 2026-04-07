# Request Detail Drawer — Design Spec

## 1. Overview

Add a "Request Detail" feature to the Usage page. Clicking any row in the request records table opens a right-side drawer that shows the raw request payload fetched from the server log, alongside the existing usage metadata already available in the row.

## 2. Architecture

### 2.1 Correlation

- Each `UsageRecord` has a `requestId` field — this is Fastify's `req.id`, and every log line for that request carries the same `reqId` field.
- To retrieve the request payload, the UI calls a new server API endpoint that searches the rotating log files for lines matching the `requestId`, extracts the log entry containing `type: "request body"`, and returns the `data` field (the resolved request body).

### 2.2 Data Flow

```
User clicks row
  → UsagePage passes requestId to RequestDetailDrawer
  → Drawer calls GET /api/usage/logs?requestId=<id>
  → Server searches ~/.claude-code-router/logs/ccr-*.log for JSON lines where reqId == <id> and type == "request body"
  → Returns { model, messages, system, max_tokens, ... } or { error }
  → Drawer renders payload in structured sections
```

### 2.3 Files to Create/Modify

| File | Action |
|---|---|
| `packages/server/src/plugins/usage-tracking.ts` | Add `GET /api/usage/logs` route handler |
| `packages/shared/src/usage/` (new) | Add `logReader.ts` — log file search utility |
| `packages/ui/src/lib/api.ts` | Add `getUsageRequestLog(requestId)` method |
| `packages/ui/src/components/usage/RecordsTable.tsx` | Add `onRowClick` prop |
| `packages/ui/src/components/UsagePage.tsx` | Render `RequestDetailDrawer`, wire up click |
| `packages/ui/src/components/usage/RequestDetailDrawer.tsx` | **New** — drawer component |

## 3. Server — Log Search API

### Endpoint

```
GET /api/usage/logs?requestId=<requestId>
```

### Response

**Success (200):**
```json
{
  "requestId": "abc123",
  "timestamp": "2026-04-07T10:00:00.000Z",
  "provider": "anthropic",
  "model": "claude-sonnet-4-7",
  "payload": {
    "model": "claude-sonnet-4-7",
    "messages": [...],
    "system": "...",
    "max_tokens": 8192,
    "stream": true,
    "tools": [...],
    "tool_choice": {...}
  }
}
```

**Not found (200 with empty payload):**
```json
{
  "requestId": "abc123",
  "payload": null,
  "reason": "log entry not found or request body not logged"
}
```

**Error (5xx):**
```json
{ "error": "failed to read log files" }
```

### Implementation Notes

- Search in log files from the past **7 days** only (avoid scanning all historical logs).
- Parse each log file line as JSON; skip non-JSON lines.
- Return the first line where `reqId === requestId && type === "request body"`.
- Use `grep`-equivalent approach: read files line-by-line, stop at first match. Do **not** load entire files into memory.

## 4. UI — Request Detail Drawer

### 4.1 Placement

- Rendered as a sibling to the page content in `UsagePage.tsx`, controlled by local state:
  ```tsx
  const [selectedRequest, setSelectedRequest] = useState<UsageRecord | null>(null);
  ```
- Position: right side, full height, width ~600px on desktop.
- Overlay: semi-transparent backdrop covers the rest of the page.

### 4.2 Sections (each collapsible)

The drawer has a fixed header showing basic info, followed by 3 collapsible sections:

**Section 1 — Basic Info** (expanded by default)
- Request ID
- Timestamp
- Provider
- Model
- Stream mode
- Duration
- TTFT (if available)

**Section 2 — Messages** (expanded by default, but messages list collapsed by default)
- Total message count
- Role list preview: `[user, assistant, user, ...]`
- Expandable: click to show full JSON of each message (or all messages collapsed into one code block)
- System prompt: separate collapsible sub-section if present

**Section 3 — Request Parameters** (collapsed by default)
- `max_tokens`, `temperature`, `top_p`, `tools`, `tool_choice`, `thinking`, etc.
- Any parameter present in the payload but not in the above list

**Section 4 — Raw JSON** (collapsed by default)
- Full payload as pretty-printed JSON (read-only `<pre><code>` block)

### 4.3 Interaction

- Click row → open drawer
- Click ✕ or backdrop → close drawer
- Press Escape → close drawer
- Drawer shows a loading spinner while fetching the log
- Drawer shows an error state if the fetch fails

### 4.4 Styling

- Use the existing shadcn/ui `Sheet` component (already in the project) for the drawer pattern.
- Use `ScrollArea` for long content.
- Use `Accordion` for collapsible sections.
- Code blocks use the existing syntax-highlight style (Monaco Editor is NOT needed — simple `<pre>` with CSS is sufficient).

## 5. Error Handling

| Scenario | Behavior |
|---|---|
| Log file not found | Return `{ payload: null, reason: "log file not found" }` |
| Request body not in logs | Return `{ payload: null, reason: "log entry not found" }` |
| Log read error | Return `{ error: "..." }`, drawer shows error message |
| Empty payload | Drawer shows "No request payload found for this record" |

## 6. Out of Scope

- Response body logging / retrieval (not currently captured)
- Original request body before routing/transformers (only post-router body is logged)
- Storing payload in the UsageRecord itself
- Export / download of the payload
