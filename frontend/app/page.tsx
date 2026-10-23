"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat, type Citation } from "../lib/api";

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
  "报销流程需要几天？",
  "新员工入职要准备哪些材料？",
  "年假可以跨年结转吗？",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrieving, setRetrieving] = useState(false);

  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
        // 用户主动中断不算错误
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

  const stop = () => abortRef.current?.abort();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="min-h-[52vh] space-y-6">
        {messages.length === 0 && (
          <div className="pt-10 text-center">
            <h1 className="text-xl font-bold">问点什么吧</h1>
            <p className="mt-2 text-sm text-muted">
              回答会标注引用来源，找不到就直接说找不到。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted hover:border-brand hover:text-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <div className="whitespace-pre-wrap text-sm leading-7">
                {m.content || (retrieving ? "正在检索资料…" : "")}
                {busy && i === messages.length - 1 && m.content && (
                  <span className="caret" />
                )}
              </div>

              {m.error && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {m.error}
                </div>
              )}

              {!!m.citations?.length && (
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="mb-2 text-xs font-semibold text-muted">
                    引用来源（{m.citations.length}）
                  </div>
                  <ul className="space-y-1.5">
                    {m.citations.map((c) => (
                      <li
                        key={c.chunk_id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="truncate text-ink">
                          {c.document}
                          {c.page ? ` · 第 ${c.page} 页` : ""}
                        </span>
                        <span className="shrink-0 text-muted">
                          {(c.score * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {m.meta && (
                <div className="text-[11px] text-muted">
                  {m.meta.model} · {m.meta.latency_ms}ms · $
                  {m.meta.cost_usd.toFixed(4)} · {m.meta.tokens.in}/
                  {m.meta.tokens.out} tokens
                </div>
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 bg-[#f5f6f8] pt-4">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-white p-2">
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
            placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
          />
          {busy ? (
            <button
              onClick={stop}
              className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
