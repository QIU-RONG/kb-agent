"use client";

import { useCallback, useEffect, useState } from "react";
import {
  correctTicket,
  createTicket,
  listTickets,
  type Ticket,
} from "../../lib/api";

const CATEGORIES = ["billing", "account", "bug", "feature", "other"];

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyHuman, setOnlyHuman] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await listTickets(onlyHuman ? { needs_human: true } : {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onlyHuman]);

  useEffect(() => {
    reload();
  }, [reload]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      await createTicket(title, body);
      setTitle("");
      setBody("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const fix = async (id: string, category: string) => {
    await correctTicket(id, category);
    await reload();
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-lg font-bold">工单台</h1>
      <p className="mt-1 text-sm text-muted">
        提交即自动分流。置信度低于 0.7 的会标为待人工，人工纠正后回流。
      </p>

      {/* 新建 */}
      <div className="mt-5 rounded-xl border border-line bg-white p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="工单标题"
          className="w-full border-b border-line pb-2 text-sm outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="问题描述…"
          className="mt-2 w-full resize-none text-sm outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={submit}
            disabled={submitting || !title.trim() || !body.trim()}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {submitting ? "分流中…" : "提交并分流"}
          </button>
        </div>
      </div>

      {/* 筛选 */}
      <div className="mt-5 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={onlyHuman}
            onChange={(e) => setOnlyHuman(e.target.checked)}
          />
          只看待人工
        </label>
        <span className="text-muted">共 {tickets.length} 条</span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* 列表 */}
      <div className="mt-3 space-y-2">
        {loading &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-line bg-white"
            />
          ))}

        {!loading && tickets.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white py-12 text-center text-sm text-muted">
            还没有工单，上面提交一条试试
          </div>
        )}

        {!loading &&
          tickets.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border bg-white p-4 ${
                t.needs_human ? "border-amber-300" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{t.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted">{t.body}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-semibold">
                    {t.category ?? "—"}
                    {t.priority ? ` / ${t.priority}` : ""}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {t.confidence !== null
                      ? `置信度 ${(t.confidence * 100).toFixed(0)}%`
                      : "未分流"}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs">
                {t.needs_human && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                    待人工
                  </span>
                )}
                {t.corrected_by && (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-green-800">
                    已纠正
                  </span>
                )}
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && fix(t.id, e.target.value)}
                  className="ml-auto rounded border border-line bg-white px-2 py-1"
                >
                  <option value="">纠正分类…</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
      </div>
    </main>
  );
}
