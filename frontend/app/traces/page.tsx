"use client";

import { useCallback, useEffect, useState } from "react";
import { getTrace, listTraces, type Span, type TraceDetail, type TraceSummary } from "../../lib/api";

const SPAN_LABEL: Record<string, string> = {
  rewrite: "查询改写",
  retrieve: "向量检索",
  grade: "相关性判分",
  generate: "生成回答",
  fallback: "降级兜底",
};

export default function TracesPage() {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTraces(await listTraces({ fallback_only: fallbackOnly, limit: 30 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fallbackOnly]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await getTrace(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold">链路追踪</h1>
          <p className="mt-1 text-sm text-muted">
            每次问答的每一步：改写后的查询、每条候选得分、判分结论、生成耗时。
            定位 badcase 先看判分，能立刻分清是「没召回」还是「答错了」。
          </p>
        </div>
        <button
          onClick={reload}
          className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-muted hover:border-brand hover:text-brand"
        >
          刷新
        </button>
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={fallbackOnly}
            onChange={(e) => setFallbackOnly(e.target.checked)}
          />
          只看拒答
        </label>
        <span className="text-muted">共 {traces.length} 条</span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-line bg-white" />
          ))}

        {!loading && traces.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white py-12 text-center text-sm text-muted">
            还没有记录，去问答页问几个问题
          </div>
        )}

        {traces.map((t) => (
          <div key={t.id} className="overflow-hidden rounded-xl border border-line bg-white">
            <button
              onClick={() => toggle(t.id)}
              className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-[#fafbfd]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{t.question}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span className={t.fallback ? "text-amber-700" : "text-green-700"}>
                    {t.fallback ? "拒答" : `命中 ${t.hit_count}`}
                  </span>
                  <span>·</span>
                  <span>{t.latency_ms}ms</span>
                  <span>·</span>
                  <span>${t.cost_usd.toFixed(6)}</span>
                  <span>·</span>
                  <span>
                    {t.tokens_in}/{t.tokens_out} tok
                  </span>
                  <span>·</span>
                  <span>{new Date(t.created_at).toLocaleString("zh-CN")}</span>
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted">{openId === t.id ? "收起" : "展开"}</span>
            </button>

            {openId === t.id && (
              <div className="border-t border-line bg-[#fafbfd] px-4 py-4">
                {!detail && <div className="text-xs text-muted">加载中…</div>}
                {detail && (
                  <>
                    <div className="space-y-2">
                      {detail.spans.map((s) => (
                        <SpanRow key={s.seq} span={s} total={detail.latency_ms} />
                      ))}
                    </div>
                    <div className="mt-4 rounded-lg border border-line bg-white p-3">
                      <div className="text-[11px] font-semibold text-muted">最终回答</div>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-6">
                        {detail.answer || "（空）"}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}

function SpanRow({ span, total }: { span: Span; total: number }) {
  const pct = total > 0 ? Math.min(100, (span.duration_ms / total) * 100) : 0;
  const failed = span.status !== "ok";

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{SPAN_LABEL[span.name] ?? span.name}</span>
          {failed && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
              失败
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted">
          +{span.started_ms}ms · {span.duration_ms}ms
        </span>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.max(2, pct)}%`, opacity: failed ? 0.4 : 1 }}
        />
      </div>

      <div className="mt-2 space-y-0.5">
        {Object.entries(span.data).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[11px] leading-5">
            <span className="shrink-0 text-muted">{k}</span>
            <span className="break-all text-ink">
              {typeof v === "object" ? JSON.stringify(v, null, 0) : String(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
