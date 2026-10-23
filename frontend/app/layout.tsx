import type { Metadata } from "next";
import { Nav } from "../components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "kb-agent · 知识库问答",
  description: "知识库问答 + 工单分流",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：浏览器扩展（如 Trancy、翻译类插件）会往 <html>
    // 注入自己的属性（例如 trancy-version="x.y.z"），服务端渲染没有、客户端有，
    // React 就会报 hydration 不匹配。这不是应用代码的问题，所以只在这一层抑制。
    // 注意：只影响 <html> 自身的属性差异，不会掩盖组件内部真正的 hydration 错误。
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-[#f5f6f8]">
        <Nav />
        {children}
      </body>
    </html>
  );
}
