"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type DocumentOut,
} from "../../lib/api";

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  parsing: "解析中",
  indexed: "已索引",
  failed: "失败",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  parsing: "bg-blue-100 text-blue-700",
  indexed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      setDocs(await listDocuments());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // 有文档在解析时轮询——这是"后台任务 + 状态轮询"的客户端配合方式
  useEffect(() => {
    const busy = docs.some((d) => d.status === "pending" || d.status === "parsing");
    if (!busy) return;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [docs, reload]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    await deleteDocument(id);
    await reload();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-lg font-bold">文档库</h1>
      <p className="mt-1 text-sm text-muted">
        支持 PDF / Word / Markdown / 文本，单文件上限 20MB。上传后后台解析，可关闭页面。
      </p>

      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white py-10 hover:border-brand">
        <span className="text-sm text-muted">
          {uploading ? "上传中…" : "点击选择文件，或拖到这里"}
        </span>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.md,.txt,.html"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </label>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 space-y-2">
        {docs.length === 0 && (
          <div className="py-10 text-center text-sm text-muted">还没有文档</div>
        )}
        {docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{d.filename}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {(d.size_bytes / 1024).toFixed(0)} KB · {d.chunk_count} 个切片
                {d.error ? ` · ${d.error}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                  STATUS_STYLE[d.status] ?? ""
                }`}
              >
                {STATUS_LABEL[d.status] ?? d.status}
              </span>
              <button
                onClick={() => remove(d.id)}
                className="text-xs text-muted hover:text-red-600"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
