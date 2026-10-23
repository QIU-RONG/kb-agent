import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "kb-agent · 知识库问答",
  description: "知识库问答 + 工单分流",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="mx-auto max-w-5xl px-6 pt-8">
          <nav className="flex items-center gap-6 border-b border-line pb-4 text-sm">
            <span className="font-bold">kb-agent</span>
            <Link href="/" className="text-muted hover:text-brand">
              问答
            </Link>
            <Link href="/tickets" className="text-muted hover:text-brand">
              工单台
            </Link>
            <Link href="/documents" className="text-muted hover:text-brand">
              文档
            </Link>
            <Link href="/traces" className="text-muted hover:text-brand">
              链路
            </Link>
          </nav>
        </div>
        {children}
      </body>
    </html>
  );
}
