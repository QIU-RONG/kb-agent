const BASE = 'http://127.0.0.1:9222';
const OUT = 'C:/Users/TIE/WorkBuddy AI/2026-10-22-16-20-01/kb-agent/docs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(path, file, steps) {
  const target = await (await fetch(`${BASE}/json/new?${path}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = id++; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await new Promise((r) => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await sleep(4500);
  if (steps) await steps(send, sleep);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const fs = await import('node:fs');
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log('shot:', file);
  await fetch(`${BASE}/json/close/${target.id}`);
  ws.close();
}

const login = async (send, sleep) => {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('能看到 HR 敏感文档'));
      if (!b) return 'NO_BTN';
      b.click(); return 'OK';
    })()`,
    returnByValue: true,
  });
  console.log('login:', r.result?.result?.value);
  await sleep(5000);
};

// 文档页（新上传区）
await shot('http://127.0.0.1:3000/documents', `${OUT}/shot-documents.png`, login);

// 工单页（新卡片 + 置信度条）
await shot('http://127.0.0.1:3000/tickets', `${OUT}/shot-tickets.png`, async (send, sleep) => {
  await login(send, sleep);
  await sleep(1500);
});

// 链路页（时间轴）
await shot('http://127.0.0.1:3000/traces', `${OUT}/shot-traces.png`, async (send, sleep) => {
  await login(send, sleep);
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('展开'));
      if (!b) return 'NO_ROW';
      b.click(); return 'OPEN';
    })()`,
    returnByValue: true,
  });
  console.log('expand:', r.result?.result?.value);
  await sleep(3000);
});
