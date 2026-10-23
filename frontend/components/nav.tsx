"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "问答" },
  { href: "/documents", label: "文档" },
  { href: "/tickets", label: "工单台" },
  { href: "/traces", label: "链路" },
  { href: "/metrics", label: "成本" },
];

export function Nav() {
  const pathname = usePathname();

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

        <div className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#1f7a3d]" />
          local · deepseek
        </div>
      </div>
    </header>
  );
}
