"use client";

import { useCallback, useEffect, useState } from "react";
import { getTrace, listTraces, type Span, type TraceDetail, type TraceSummary } from "../../lib/api";
import { PageHeader } from "../../components/page-header";

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
      <PageHeader
        title="链路追踪"
        desc="每次问答的每一步：改写后的查询、每条候选得分、判分结论、生成耗时。定位 badcase 先看判分，能立刻分清是「没召回」还是「答错了」。"
        right={
          <button
            onClick={reload}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-brand hover:text-brand"
          >
            刷新
          </button>
        }
      />

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
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-line bg-white" />
          ))}

        {!loading && traces.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-white py-14 text-center">
            <div className="text-[13px] text-muted">还没有记录</div>
            <div className="mt-1 text-[11.5px] text-faint">去问答页问几个问题，这里会出现每一步的细节</div>
          </div>
        )}

        {traces.map((t) => (
          <div
            key={t.id}
            className="overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-shadow hover:shadow-lift"
          >
            <button
              onClick={() => toggle(t.id)}
              className="flex w-full items-start justify-between gap-4 px-4 py-3.5 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
                      t.fallback
                        ? "bg-[#faeeda] text-[#854f0b]"
                        : "bg-[#e8f5ec] text-[#1f7a3d]"
                    }`}
                  >
                    {t.fallback ? "拒答" : `命中 ${t.hit_count}`}
                  </span>
                  <span className="truncate text-[13.5px] font-medium">{t.question}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-0.5 font-mono text-[10.5px] text-faint">
                  <span>{t.latency_ms}ms</span>
                  <span className="opacity-40">/</span>
                  <span>${t.cost_usd.toFixed(6)}</span>
                  <span className="opacity-40">/</span>
                  <span>
                    {t.tokens_in}/{t.tokens_out} tok
                  </span>
                  <span className="opacity-40">/</span>
                  <span>{new Date(t.created_at).toLocaleString("zh-CN")}</span>
                </div>
              </div>
              <span className="shrink-0 pt-0.5 text-[11.5px] text-faint">
                {openId === t.id ? "收起" : "展开"}
              </span>
            </button>

            {openId === t.id && (
              <div className="border-t border-line bg-[#fafbfd] px-4 py-4">
                {!detail && <div className="text-[12px] text-faint">加载中…</div>}
                {detail && (
                  <>
                    <div className="space-y-0">
                      {detail.spans.map((s, i) => (
                        <SpanRow
                          key={s.seq}
                          span={s}
                          total={detail.latency_ms}
                          last={i === detail.spans.length - 1}
                        />
                      ))}
                    </div>
                    <div className="mt-3 rounded-xl border border-line bg-white p-3">
                      <div className="text-[11px] font-medium text-muted">最终回答</div>
                      <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-6 text-[#39415a]">
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

/** 一个步骤：左侧时间轴，右侧耗时条与入参出参 */
function SpanRow({ span, total, last }: { span: Span; total: number; last: boolean }) {
  const pct = total > 0 ? Math.min(100, (span.duration_ms / total) * 100) : 0;
  const failed = span.status !== "ok";

  return (
    <div className="relative pl-5">
      {/* 时间轴：竖线 + 节点 */}
      {!last && <span className="absolute left-[3.5px] top-4 h-full w-px bg-line" />}
      <span
        className={`absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full ring-2 ring-[#fafbfd] ${
          failed ? "bg-[#b3261e]" : "bg-brand"
        }`}
      />

      <div className="pb-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold">
              {SPAN_LABEL[span.name] ?? span.name}
            </span>
            {failed && (
              <span className="rounded bg-[#fdeaea] px-1.5 py-0.5 text-[10px] font-semibold text-[#a1231b]">
                失败
              </span>
            )}
          </div>
          <span className="font-mono text-[10.5px] text-faint">
            +{span.started_ms} · {span.duration_ms}ms
          </span>
        </div>

        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[#eef0f4]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(1.5, pct)}%`,
              background: failed ? "#d98b86" : "#2f6fed",
            }}
          />
        </div>

        <div className="mt-1.5 space-y-0.5">
          {Object.entries(span.data).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[11px] leading-5">
              <span className="w-[86px] shrink-0 text-faint">{k}</span>
              <span className="break-all font-mono text-[10.5px] text-[#4a5162]">
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
