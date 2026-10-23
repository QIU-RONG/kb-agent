#!/usr/bin/env bash
# 一键启动：后端 8000 + 前端 3000
#
# 用法：
#   bash scripts/dev.sh
#
# 说明：
# - 已经跑起来的服务会跳过，不会重复启动
# - 日志写到 logs/ 下
# - 停止：Ctrl+C 只停本脚本拉起的进程；已在别处启动的需自己关
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs

# 注意：--noproxy 的 '*' 必须加引号，否则会被 shell 展开成当前目录的文件名，
# 把 curl 的参数顺序冲乱（表现为直接把 HTML 打到终端）
check() { # $1=url
  curl -s --noproxy '*' -m 2 -o /dev/null "$1" 2>/dev/null
}

# ---------- 后端 ----------
if check "http://127.0.0.1:8000/health"; then
  echo "[skip] 后端已在 8000 运行"
else
  PY="$ROOT/backend/.venv/Scripts/python.exe"
  [ -x "$PY" ] || PY="$ROOT/backend/.venv/bin/python"
  if [ ! -x "$PY" ]; then
    echo "[err] 找不到虚拟环境，先执行："
    echo "      cd backend && python -m venv .venv && .venv/Scripts/python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -e \".[dev]\""
    exit 1
  fi
  echo "[start] 后端 ..."
  ( cd backend && "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 ) \
    > logs/backend.log 2>&1 &
  echo $! > logs/backend.pid
fi

# ---------- 前端 ----------
if check "http://127.0.0.1:3000/"; then
  echo "[skip] 前端已在 3000 运行"
else
  echo "[start] 前端 ..."
  # NEXT_DIST_DIR：某些环境的文件守卫会拦住 next dev 清理 .next，换个目录绕过
  ( cd frontend && NEXT_DIST_DIR=.next-dev-run "C:/Users/TIE/.workbuddy-ai/binaries/node/versions/22.22.2-6/npm.cmd" run dev ) \
    > logs/frontend.log 2>&1 &
  echo $! > logs/frontend.pid
fi

# ---------- 等待就绪 ----------
echo "[wait] 等待服务就绪 ..."
for i in $(seq 1 40); do
  b=0; f=0
  check "http://127.0.0.1:8000/health" && b=1
  check "http://127.0.0.1:3000/" && f=1
  if [ "$b" = "1" ] && [ "$f" = "1" ]; then break; fi
  sleep 1
done

echo ""
if check "http://127.0.0.1:8000/health"; then
  echo "后端  http://127.0.0.1:8000/docs"
  curl -s --noproxy '*' http://127.0.0.1:8000/health
  echo ""
else
  echo "后端启动失败，看 logs/backend.log"
fi

if check "http://127.0.0.1:3000/"; then
  echo "前端  http://localhost:3000"
else
  echo "前端启动失败，看 logs/frontend.log"
fi

echo ""
echo "提示：模型 key 从环境变量 DEEPSEEK_API_KEY 读取，没配会退回 mock 模式（链路照常，回答是固定文本）。"
