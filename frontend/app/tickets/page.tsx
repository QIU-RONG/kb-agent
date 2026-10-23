"use client";

import { useCallback, useEffect, useState } from "react";
import {
  correctTicket,
  createTicket,
  listTickets,
  type Ticket,
} from "../../lib/api";
import { PageHeader } from "../../components/page-header";

const CATEGORIES = ["billing", "account", "bug", "feature", "other"];

const CATEGORY_STYLE: Record<string, string> = {
  billing: "bg-[#e8f0fe] text-[#1a4fa0]",
  account: "bg-[#efe9fb] text-[#4b3fa8]",
  bug: "bg-[#fdeaea] text-[#a1231b]",
  feature: "bg-[#e8f5ec] text-[#1f7a3d]",
  other: "bg-[#f1f3f8] text-[#5f6673]",
};

const PRIORITY_STYLE: Record<string, string> = {
  p0: "bg-[#fdeaea] text-[#a1231b]",
  p1: "bg-[#faeeda] text-[#854f0b]",
  p2: "bg-[#e8f0fe] text-[#1a4fa0]",
  p3: "bg-[#f1f3f8] text-[#5f6673]",
};

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
    <main className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="工单台"
        desc="提交即自动分流。置信度低于 0.7 的会标为待人工，人工纠正后回流。"
      />

      {/* 新建 */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="工单标题"
          className="w-full rounded-lg border border-line bg-[#fbfcfd] px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-[#c7d3ff] focus:bg-white"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="问题描述…（写得越具体，分类越准）"
          className="mt-2 w-full resize-none rounded-lg border border-line bg-[#fbfcfd] px-3 py-2 text-[13.5px] leading-6 outline-none transition-colors focus:border-[#c7d3ff] focus:bg-white"
        />
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-faint">
            输出严格 JSON：分类 / 优先级 / 置信度
          </span>
          <button
            onClick={submit}
            disabled={submitting || !title.trim() || !body.trim()}
            className="rounded-xl bg-brand px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {submitting ? "分流中…" : "提交并分流"}
          </button>
        </div>
      </div>

      {/* 筛选 */}
      <div className="mt-5 flex items-center gap-3 text-[12px]">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-muted transition-colors hover:border-[#c7d3ff]">
          <input
            type="checkbox"
            checked={onlyHuman}
            onChange={(e) => setOnlyHuman(e.target.checked)}
            className="accent-brand"
          />
          只看待人工
        </label>
        <span className="text-faint">共 {tickets.length} 条</span>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {/* 列表 */}
      <div className="mt-3 space-y-2">
        {loading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-line bg-white" />
          ))}

        {!loading && tickets.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-white py-14 text-center">
            <div className="text-[13px] text-muted">还没有工单</div>
            <div className="mt-1 text-[11.5px] text-faint">上面提交一条，看看它会被分到哪一类</div>
          </div>
        )}

        {!loading &&
          tickets.map((t) => (
            <div
              key={t.id}
              className={`rounded-2xl border bg-white p-4 shadow-card transition-shadow hover:shadow-lift ${
                t.needs_human ? "border-amber-200" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">{t.title}</div>
                  <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{t.body}</div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      CATEGORY_STYLE[t.category ?? ""] ?? "bg-[#f1f3f8] text-[#5f6673]"
                    }`}
                  >
                    {t.category ?? "未分类"}
                  </span>
                  {t.priority && (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${
                        PRIORITY_STYLE[t.priority] ?? "bg-[#f1f3f8] text-[#5f6673]"
                      }`}
                    >
                      {t.priority}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
                <Confidence value={t.confidence} />

                {t.needs_human && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    待人工
                  </span>
                )}
                {t.corrected_by && (
                  <span className="rounded-md bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
                    已纠正
                  </span>
                )}

                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && fix(t.id, e.target.value)}
                  className="ml-auto rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] text-muted outline-none transition-colors hover:border-[#c7d3ff]"
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

/** 置信度：数值 + 细条，比纯文字更容易一眼看出高低 */
function Confidence({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[11px] text-faint">未分流</span>;
  }
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "#1f7a3d" : pct >= 50 ? "#b8860b" : "#b3261e";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-faint">置信度</span>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-[#eef0f4]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-medium tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}
