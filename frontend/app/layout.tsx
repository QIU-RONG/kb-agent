import type { Metadata } from "next";
import { Nav } from "../components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "kb-agent · 知识库问答",
  description: "知识库问答 + 工单分流",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#f5f6f8]">
        <Nav />
        {children}
      </body>
    </html>
  );
}
