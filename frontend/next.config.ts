import type { NextConfig } from "next";

// BFF 转发目标。用 127.0.0.1 而非 localhost：
// Node 在 Windows 上可能先解析到 ::1，而 uvicorn 绑的是 IPv4。
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // 构建目录可通过环境变量覆盖：CI 并行构建、或本地 .next 被占用/损坏时
  // 用一个全新目录，避免启动阶段去清理旧产物
  distDir: process.env.NEXT_DIST_DIR || ".next",

  async rewrites() {
    return [
      {
        // 文档 / 工单 / 指标这类普通 REST 接口直接透传；
        // 流式的 /api/chat 由 app/api/chat/route.ts 单独处理（需要保留 SSE 语义）
        source: "/api/v1/:path*",
        destination: `${BACKEND}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
