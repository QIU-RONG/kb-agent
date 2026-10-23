"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login, ROLE_LABEL } from "../../lib/auth";

const DEMO = [
  { username: "emp", password: "emp123", role: "employee", note: "只能看到公开文档" },
  { username: "hr", password: "hr123", role: "hr", note: "能看到 HR 敏感文档" },
  { username: "fin", password: "fin123", role: "finance", note: "能看到财务敏感文档" },
  { username: "admin", password: "admin123", role: "admin", note: "全部可见 + 用户管理" },
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("emp");
  const [password, setPassword] = useState("emp123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (u = username, p = password) => {
    setBusy(true);
    setError(null);
    try {
      await login(u, p);
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-[11px] font-bold text-white">
            kb
          </span>
          <span className="text-[15px] font-semibold tracking-tight">kb-agent</span>
        </div>

        <h1 className="text-[22px] font-semibold tracking-tight">登录</h1>
        <p className="mt-1 text-[13px] text-muted">
          内部知识库。不同角色能检索到的文档范围不同。
        </p>

        <div className="mt-6 space-y-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-[#b9c8ff]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="密码"
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-[#b9c8ff]"
          />
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={() => submit()}
          disabled={busy || !username || !password}
          className="mt-3 w-full rounded-xl bg-brand py-2.5 text-[13.5px] font-medium text-white disabled:opacity-40"
        >
          {busy ? "登录中…" : "登录"}
        </button>

        <div className="mt-7">
          <div className="mb-2 text-[11px] font-medium text-muted">演示账号（点一下直接登录）</div>
          <div className="space-y-1.5">
            {DEMO.map((d) => (
              <button
                key={d.username}
                onClick={() => {
                  setUsername(d.username);
                  setPassword(d.password);
                  submit(d.username, d.password);
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 text-left hover:border-[#b9c8ff] hover:bg-[#fbfcff]"
              >
                <span className="w-14 shrink-0 text-[12px] font-medium">
                  {ROLE_LABEL[d.role]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{d.note}</span>
                <span className="shrink-0 font-mono text-[11px] text-[#a4abb8]">
                  {d.username}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#a4abb8]">
            演示用弱密码，真实项目里不会这样建用户。
          </p>
        </div>
      </div>
    </main>
  );
}
