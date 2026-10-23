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

async function loginAs(send, keyword) {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('${keyword}'));
      if (!b) return 'NO_BTN';
      b.click(); return 'OK';
    })()`,
    returnByValue: true,
  });
  return r.result?.result?.value;
}

// 登录后的空态
await shot('http://127.0.0.1:3000/login', `${OUT}/shot-home.png`, async (send, sleep) => {
  console.log('login:', await loginAs(send, '能看到 HR 敏感文档'));
  await sleep(6000);
});

// 文档页
await shot('http://127.0.0.1:3000/documents', `${OUT}/shot-documents.png`, async (send, sleep) => {
  console.log('login:', await loginAs(send, '能看到 HR 敏感文档'));
  await sleep(5000);
});

// 成本页
await shot('http://127.0.0.1:3000/metrics', `${OUT}/shot-metrics.png`, async (send, sleep) => {
  console.log('login:', await loginAs(send, '能看到 HR 敏感文档'));
  await sleep(5000);
});
