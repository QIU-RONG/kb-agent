/**
 * BFF：把后端 SSE 原样透传给浏览器。
 *
 * 为什么要有这一层？
 * 1. 模型密钥只存在服务端，浏览器拿不到
 * 2. 可以在这里做鉴权、限流、审计
 * 3. 后端地址不暴露给前端
 */

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/v1/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 登录态由浏览器带上，这里原样透传；密钥仍然只在服务端
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization") as string }
          : {}),
      },
      body,
      // 关键：把浏览器的中断信号传下去，
      // 用户点"停止"时后端也能感知并终止生成（省 token）
      signal: req.signal,
    });
  } catch (err) {
    return Response.json(
      { message: `后端不可达：${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (upstream.status === 401) {
    return Response.json({ message: "未登录" }, { status: 401 });
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { message: `后端返回 ${upstream.status}` },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 防止 nginx 缓冲导致"不流"
    },
  });
}
