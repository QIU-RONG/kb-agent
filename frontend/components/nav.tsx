"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, getUser, logout, ROLE_LABEL, type AuthUser } from "../lib/auth";

const LINKS = [
  { href: "/", label: "问答" },
  { href: "/documents", label: "文档" },
  { href: "/tickets", label: "工单台" },
  { href: "/traces", label: "链路" },
  { href: "/metrics", label: "成本" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    const u = getUser();

    if (!token) {
      setReady(true);
      if (pathname !== "/login") router.replace("/login");
      return;
    }

    setUser(u);
    setReady(true);
  }, [pathname, router]);

  // 登录页不显示导航，避免"未登录却能点进去"的错觉
  if (pathname === "/login") return null;

  if (!ready) {
    return <div className="h-14 border-b border-line bg-white" />;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-[11px] font-bold text-white">
            kb
          </span>
          <span className="text-sm font-semibold tracking-tight">kb-agent</span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "bg-[#eef2ff] font-semibold text-brand"
                    : "text-muted hover:bg-[#f5f6f8] hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user && (
            <>
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#eef2ff] text-[10px] font-bold text-brand">
                  {user.display_name.slice(0, 1)}
                </span>
                <div className="hidden leading-tight sm:block">
                  <div className="text-[12px] font-medium">{user.display_name}</div>
                  <div className="text-[10px] text-muted">
                    {ROLE_LABEL[user.role] ?? user.role} · 可见 {user.scopes.join("/")}
                  </div>
                </div>
              </div>
              <button
                onClick={logout}
                className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-[#f5f6f8] hover:text-ink"
              >
                退出
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
