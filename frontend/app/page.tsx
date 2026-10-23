"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getChunk, streamChat, type ChunkOut, type Citation } from "../lib/api";

type Meta = {
  cost_usd: number;
  latency_ms: number;
  tokens: { in: number; out: number };
  model: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  meta?: Meta;
  error?: string;
};

const SAMPLES = [
  { q: "报销流程需要几天？", hint: "流程与时效" },
  { q: "出差住酒店能报多少钱？", hint: "差旅标准" },
  { q: "年假可以跨年结转吗？", hint: "假期规则" },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      setInput("");
      setBusy(true);
      setRetrieving(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: question },
        { role: "assistant", content: "", citations: [] },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      const patchLast = (fn: (m: Msg) => Msg) =>
        setMessages((prev) => {
          const next = [...prev];
          const i = next.length - 1;
          next[i] = fn(next[i]);
          return next;
        });

      try {
        await streamChat(
          { message: question, conversation_id: conversationId.current },
          {
            onRetrieval: (p) => {
              setRetrieving(false);
              if (p.hits === 0) {
                patchLast((m) => ({ ...m, error: "未检索到相关文档" }));
              }
            },
            onCitation: (c) => {
              patchLast((m) => {
                const list = m.citations ?? [];
                if (list.some((x) => x.chunk_id === c.chunk_id)) return m;
                return { ...m, citations: [...list, c] };
              });
            },
            onDelta: (t) => patchLast((m) => ({ ...m, content: m.content + t })),
            onDone: (p) => {
              conversationId.current = p.conversation_id;
              patchLast((m) => ({
                ...m,
                meta: {
                  cost_usd: p.cost_usd,
                  latency_ms: p.latency_ms,
                  tokens: p.tokens,
                  model: p.model,
                },
              }));
            },
            onError: (message) => patchLast((m) => ({ ...m, error: message })),
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patchLast((m) => ({ ...m, error: (err as Error).message }));
        }
      } finally {
        setBusy(false);
        setRetrieving(false);
        abortRef.current = null;
      }
    },
    [busy],
  );

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  const empty = messages.length === 0;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col px-6">
      <div className="flex-1 py-8">
        {empty && (
          <div className="pt-8">
            <h1 className="text-[26px] font-semibold tracking-tight">问点什么吧</h1>
            <p className="mt-2 text-sm text-muted">
              回答会标注引用来源，点开能看原文。找不到就直接说找不到。
            </p>
            <div className="mt-7 grid gap-2 sm:grid-cols-3">
              {SAMPLES.map((s) => (
                <button
                  key={s.q}
                  onClick={() => send(s.q)}
                  className="group rounded-xl border border-line bg-white p-4 text-left transition-colors hover:border-[#b9c8ff] hover:bg-[#fbfcff]"
                >
                  <div className="text-[11px] font-medium text-muted">{s.hint}</div>
                  <div className="mt-1.5 text-[13px] leading-6 text-ink group-hover:text-brand">
                    {s.q}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-7">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[13.5px] leading-6 text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-[#eef2ff] text-[10px] font-bold text-brand">
                    AI
                  </span>
                  <span className="text-[12px] font-medium text-muted">kb-agent</span>
                </div>

                <div className="pl-7">
                  {m.content ? (
                    <div className="md text-[13.5px] leading-7 text-ink">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      {busy && i === messages.length - 1 && <span className="caret" />}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-1 text-[13px] text-muted">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                      {retrieving ? "正在检索资料…" : "正在生成…"}
                    </div>
                  )}

                  {m.error && (
                    <div className="mt-2 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      {m.error}
                    </div>
                  )}

                  {!!m.citations?.length && <CitationList citations={m.citations} />}

                  {(m.meta || m.content) && (
                    <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted">
                      {m.meta && (
                        <span className="tabular-nums">
                          {m.meta.model} · {m.meta.latency_ms}ms · $
                          {m.meta.cost_usd.toFixed(6)} · {m.meta.tokens.in}/{m.meta.tokens.out} tok
                        </span>
                      )}
                      <button
                        onClick={() => copy(m.content, i)}
                        className="rounded px-1.5 py-0.5 hover:bg-[#f1f3f8] hover:text-ink"
                      >
                        {copied === i ? "已复制" : "复制"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-[#f5f6f8] via-[#f5f6f8] to-transparent pb-5 pt-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,.04)] focus-within:border-[#b9c8ff]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="问点什么… Enter 发送，Shift+Enter 换行"
            className="max-h-32 flex-1 resize-none bg-transparent px-2.5 py-2 text-[13.5px] leading-6 outline-none placeholder:text-[#a4abb8]"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="rounded-xl bg-brand px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-35"
            >
              发送
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-[#a4abb8]">
          回答基于已索引文档，找不到会明确告知，不会编造
        </p>
      </div>
    </main>
  );
}

/** 引用列表：点一条展开原文，证明答案是从哪句话来的 */
function CitationList({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, ChunkOut>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const toggle = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (cache[id] || loading === id) return;

    setLoading(id);
    try {
      const chunk = await getChunk(id);
      setCache((prev) => ({ ...prev, [id]: chunk }));
    } catch {
      /* 取不到原文就只展示元信息 */
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line bg-[#fafbfd] px-3 py-2 text-[11px] font-medium text-muted">
        引用来源 · {citations.length} 条（点击查看原文）
      </div>
      {citations.map((c) => (
        <div key={c.chunk_id} className="border-b border-line last:border-b-0">
          <button
            onClick={() => toggle(c.chunk_id)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#fafbfd]"
          >
            <span className="text-[10px] text-muted">{open === c.chunk_id ? "▾" : "▸"}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
              {c.document}
              {c.page ? ` · 第 ${c.page} 页` : ""}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">
              {(c.score * 100).toFixed(0)}%
            </span>
          </button>

          {open === c.chunk_id && (
            <div className="border-t border-dashed border-line bg-[#fcfcfd] px-3 py-2.5">
              {loading === c.chunk_id && <div className="text-[11px] text-muted">加载中…</div>}
              {cache[c.chunk_id] && (
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans text-[12px] leading-6 text-[#4a5162]">
                  {cache[c.chunk_id].content}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
