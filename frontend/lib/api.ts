/**
 * 后端 API 客户端。类型要和 backend/app/schemas.py 对齐——
 * 改接口时两边一起改，比口头约定靠谱。
 */

const PREFIX = "/api/v1";

export type Citation = {
  chunk_id: string;
  document_id: string;
  document: string;
  page: number | null;
  score: number;
};

export type DocumentOut = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  status: "pending" | "parsing" | "indexed" | "failed";
  error: string | null;
  chunk_count: number;
  created_at: string;
};

export type Ticket = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  priority: string | null;
  confidence: number | null;
  needs_human: boolean;
  corrected_by: string | null;
  created_at: string;
};

export type Metrics = {
  total_messages: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  avg_prompt_tokens: number;
  tickets_total: number;
  tickets_needs_human: number;
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 后端 500 或 Next 404 都可能返回整页 HTML，直接塞进 UI 会很难看，
    // 这里压成一行短消息
    const brief = text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    throw new Error(`${res.status} ${brief || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------- 文档 ----------
export const listDocuments = () => json<DocumentOut[]>(`${PREFIX}/documents`);

export async function uploadDocument(file: File): Promise<DocumentOut> {
  const form = new FormData();
  form.append("file", file);
  return json<DocumentOut>(`${PREFIX}/documents`, { method: "POST", body: form });
}

export const deleteDocument = (id: string) =>
  fetch(`${PREFIX}/documents/${id}`, { method: "DELETE" });

// ---------- 工单 ----------
export const listTickets = (params: { category?: string; needs_human?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (params.category) q.set("category", params.category);
  if (params.needs_human !== undefined) q.set("needs_human", String(params.needs_human));
  return json<Ticket[]>(`${PREFIX}/tickets?${q.toString()}`);
};

export const createTicket = (title: string, body: string) =>
  json<Ticket>(`${PREFIX}/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });

export const correctTicket = (id: string, category: string) =>
  json<Ticket>(`${PREFIX}/tickets/${id}/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, corrected_by: "human" }),
  });

// ---------- 指标 ----------
export const getMetrics = () => json<Metrics>(`${PREFIX}/metrics/summary`);

// ---------- 链路追踪 ----------
export type Span = {
  name: string;
  seq: number;
  started_ms: number;
  duration_ms: number;
  status: string;
  data: Record<string, unknown>;
};

export type TraceSummary = {
  id: string;
  question: string;
  answer: string;
  model: string | null;
  hit_count: number;
  fallback: boolean;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  created_at: string;
};

export type TraceDetail = TraceSummary & { spans: Span[] };

export const listTraces = (params: { limit?: number; fallback_only?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.fallback_only) q.set("fallback_only", "true");
  return json<TraceSummary[]>(`${PREFIX}/traces?${q.toString()}`);
};

export const getTrace = (id: string) => json<TraceDetail>(`${PREFIX}/traces/${id}`);

// ---------- 流式问答 ----------
export type StreamHandlers = {
  onRetrieval?: (p: { hits: number; top_score: number }) => void;
  onCitation?: (c: Citation) => void;
  onDelta?: (text: string) => void;
  onDone?: (p: {
    message_id: string;
    conversation_id: string;
    tokens: { in: number; out: number };
    cost_usd: number;
    latency_ms: number;
    model: string;
    fallback_used: boolean;
  }) => void;
  onError?: (message: string) => void;
};

/**
 * 手动解析 SSE。
 * 为什么不用 EventSource：它不支持 POST body，也带不了自定义 header。
 * 第 2 周可以换成 Vercel AI SDK 的 useChat（它内部就是这套逻辑）。
 */
export async function streamChat(
  body: { message: string; conversation_id?: string | null },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`chat failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // sse-starlette 用 \r\n，先归一化再按空行切事件
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      let payload: any;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        continue; // 半包数据，忽略
      }

      switch (event) {
        case "retrieval":
          handlers.onRetrieval?.(payload);
          break;
        case "citation":
          handlers.onCitation?.(payload);
          break;
        case "delta":
          handlers.onDelta?.(payload.text ?? "");
          break;
        case "done":
          handlers.onDone?.(payload);
          break;
        case "error":
          handlers.onError?.(payload.message ?? "unknown error");
          break;
      }
    }
  }
}
