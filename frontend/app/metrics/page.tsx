"use client";

import { useCallback, useEffect, useState } from "react";
import { getMetrics, listTraces, type Metrics, type TraceSummary } from "../../lib/api";
import { PageHeader } from "../../components/page-header";

export default function MetricsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [metrics, recent] = await Promise.all([getMetrics(), listTraces({ limit: 20 })]);
      setM(metrics);
      setTraces(recent);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const maxLatency = Math.max(1, ...traces.map((t) => t.latency_ms));
  const humanRate =
    m && m.tickets_total > 0 ? (m.tickets_needs_human / m.tickets_total) * 100 : 0;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <PageHeader
        title="成本与质量"
        desc="所有数字来自真实调用记账，不是估算。问答的成本、延迟写在每条消息上，这里做聚合。"
      />

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 grid gap-2 sm:grid-cols-4">
        <Kpi label="问答次数" value={m ? String(m.total_messages) : "—"} unit="次" />
        <Kpi
          label="累计成本"
          value={m ? `$${m.total_cost_usd.toFixed(6)}` : "—"}
          hint={m && m.total_messages > 0 ? `单次约 $${(m.total_cost_usd / m.total_messages).toFixed(6)}` : ""}
        />
        <Kpi
          label="平均延迟"
          value={m ? m.avg_latency_ms.toFixed(0) : "—"}
          unit="ms"
          hint="不含首字等待"
        />
        <Kpi
          label="平均输入"
          value={m ? m.avg_prompt_tokens.toFixed(0) : "—"}
          unit="tok"
          hint="含检索上下文"
        />
      </div>

      <section className="mt-8">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">最近 20 次问答延迟</h2>
          <span className="text-[11px] text-muted">柱高 = 延迟，橙色 = 拒答</span>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          {traces.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted">还没有数据，去问答页问几个问题</div>
          ) : (
            <div className="flex h-28 items-end gap-1">
              {[...traces].reverse().map((t) => (
                <div
                  key={t.id}
                  title={`${t.question} · ${t.latency_ms}ms`}
                  // max-w 限制单柱宽度：数据只有两三条时，否则 flex-1 会把它拉成色块
                  className="max-w-[26px] flex-1 rounded-t-sm transition-opacity hover:opacity-70"
                  style={{
                    height: `${Math.max(4, (t.latency_ms / maxLatency) * 100)}%`,
                    background: t.fallback ? "#EF9F27" : "#378ADD",
                  }}
                />
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-between text-[11px] text-muted">
            <span>更早</span>
            {traces.length < 5 && (
              <span className="text-faint">样本较少（{traces.length} 条），柱宽固定</span>
            )}
            <span>最近</span>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">工单分流</h2>
        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{m?.tickets_total ?? "—"}</span>
            <span className="text-xs text-muted">条工单</span>
            <span className="ml-auto text-xs text-muted">
              待人工 {m?.tickets_needs_human ?? 0} 条 · {humanRate.toFixed(0)}%
            </span>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f1f3f8]">
            <div
              className="h-full rounded-full bg-amber-400 transition-all"
              style={{ width: `${Math.min(100, humanRate)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            置信度低于 0.7 的工单会被标为待人工。这个比例太高说明分类提示词或阈值需要调；
            太低则要警惕「模型过度自信」——两种都值得看一眼真实样本。
          </p>
        </div>
      </section>

      <p className="mt-6 text-[11px] leading-5 text-[#a4abb8]">
        想看单次调用的细节（每一步耗时、每条候选得分），去
        <a href="/traces" className="mx-1 text-brand underline underline-offset-2">
          链路
        </a>
        页。
      </p>
    </main>
  );
}

function Kpi({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold tabular-nums tracking-tight">{value}</span>
        {unit && <span className="text-[11px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[10.5px] text-[#a4abb8]">{hint}</div>}
    </div>
  );
}
