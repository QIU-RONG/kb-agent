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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
        inputRef.current?.focus();
      }
    },
    [busy],
  );

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  const empty = messages.length === 0;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-[760px] flex-col px-6">
      <div className="flex-1 pb-4 pt-10">
        {empty && (
          <div className="animate-fade-up pt-6">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1f7a3d]" />
              已接入 3 份文档 · 权限按角色过滤
            </div>
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em]">
              问点什么吧
            </h1>
            <p className="mt-2.5 max-w-prose text-[14px] leading-7 text-muted">
              回答会标注引用来源，点开能看原文片段。找不到就直接说找不到，不会编。
            </p>

            <div className="mt-9 grid gap-2.5 sm:grid-cols-3">
              {SAMPLES.map((s, i) => (
                <button
                  key={s.q}
                  onClick={() => send(s.q)}
                  className="group relative rounded-2xl border border-line bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-[#c7d3ff] hover:shadow-lift"
                >
                  <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">
                    <span className="tabular-nums">0{i + 1}</span>
                    <span className="h-px w-3 bg-line" />
                    {s.hint}
                  </div>
                  <div className="text-[13.5px] leading-6 text-ink transition-colors group-hover:text-brand">
                    {s.q}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-8">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex animate-fade-up justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[14px] leading-6 text-white shadow-sm">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="animate-fade-up">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-brand-soft text-[9.5px] font-bold tracking-wide text-brand">
                    AI
                  </span>
                  <span className="text-[12px] font-medium text-ink">kb-agent</span>
                  {m.meta?.model && (
                    <span className="text-[11px] text-faint">
                      · {m.meta.model.split("/").pop()}
                    </span>
                  )}
                </div>

                <div className="pl-8">
                  {m.content ? (
                    <div className="md max-w-prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      {busy && i === messages.length - 1 && <span className="caret" />}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-1 text-[13px] text-muted">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-40" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                      </span>
                      {retrieving ? "正在检索资料…" : "正在生成…"}
                    </div>
                  )}

                  {m.error && (
                    <div className="mt-3 inline-flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <span>
                        {m.error}
                        {m.error.includes("未检索") && (
                          <span className="text-amber-700/70">
                            —— 换一种问法，或确认该文档对你的角色可见
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {!!m.citations?.length && <Citations citations={m.citations} />}

                  {(m.meta || m.content) && (
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-faint">
                      {m.meta && (
                        <span className="font-mono tabular-nums">
                          {m.meta.latency_ms}ms · ${m.meta.cost_usd.toFixed(6)} ·{" "}
                          {m.meta.tokens.in}/{m.meta.tokens.out} tok
                        </span>
                      )}
                      {m.content && (
                        <button
                          onClick={() => copy(m.content, i)}
                          className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-white hover:text-ink"
                        >
                          {copied === i ? "已复制" : "复制"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
        <div ref={bottomRef} className="h-2" />
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-canvas via-canvas to-transparent pb-6 pt-4">
        <div className="flex items-end gap-2 rounded-3xl border border-line bg-white p-2 shadow-composer transition-shadow focus-within:border-[#c7d3ff] focus-within:shadow-lift">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="问点什么…"
            className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] leading-6 outline-none placeholder:text-faint"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-2xl bg-ink px-4 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="rounded-2xl bg-brand px-4 py-2.5 text-[13px] font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              发送
            </button>
          )}
        </div>
        <p className="mt-2.5 text-center text-[11px] text-faint">
          Enter 发送 · Shift + Enter 换行 · 回答基于已索引文档，找不到会明确告知
        </p>
      </div>
    </main>
  );
}

/** 引用来源：编号 chips，点开看原文片段 */
function Citations({ citations }: { citations: Citation[] }) {
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

  const active = open ? citations.find((c) => c.chunk_id === open) : null;

  return (
    <div className="mt-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {citations.map((c, i) => {
          const on = open === c.chunk_id;
          return (
            <button
              key={c.chunk_id}
              onClick={() => toggle(c.chunk_id)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors ${
                on
                  ? "border-[#c7d3ff] bg-brand-soft text-brand"
                  : "border-line bg-white text-muted hover:border-[#c7d3ff] hover:text-brand"
              }`}
            >
              <span className="font-mono text-[10.5px] opacity-70">{i + 1}</span>
              <span className="max-w-[180px] truncate">{c.document}</span>
              <span className="tabular-nums opacity-60">{(c.score * 100).toFixed(0)}%</span>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-white shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-[#fbfcfd] px-3 py-1.5">
            <span className="truncate text-[11px] text-muted">
              {active.document}
              {active.page ? ` · 第 ${active.page} 页` : ""}
            </span>
            <button
              onClick={() => setOpen(null)}
              className="shrink-0 text-[11px] text-faint hover:text-ink"
            >
              收起
            </button>
          </div>
          <div className="px-3.5 py-3">
            {loading === active.chunk_id && (
              <div className="text-[11.5px] text-faint">加载中…</div>
            )}
            {cache[active.chunk_id] && (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-[12.5px] leading-6 text-[#4a5162]">
                {cache[active.chunk_id].content}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
