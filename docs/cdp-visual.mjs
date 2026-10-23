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
  await sleep(5000);
  if (steps) await steps(send, sleep);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const fs = await import('node:fs');
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log('shot:', file);
  await fetch(`${BASE}/json/close/${target.id}`);
  ws.close();
}

// 空态
await shot('http://127.0.0.1:3000/', `${OUT}/shot-home.png`, async (send, sleep) => {
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('kb_token','x'); localStorage.setItem('kb_user', JSON.stringify({id:'t',username:'hr',display_name:'HR 专员',role:'hr',scopes:['public','hr']}));`,
    returnByValue: true,
  });
  await send('Page.reload');
  await sleep(4500);
});

// 登录后提问 + 展开引用
await shot('http://127.0.0.1:3000/login', `${OUT}/shot-chat.png`, async (send, sleep) => {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('能看到 HR 敏感文档'));
      if (!b) return 'NO_BTN';
      b.click(); return 'OK';
    })()`,
    returnByValue: true,
  });
  console.log('login:', r.result?.result?.value);
  await sleep(5500);

  await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('报销流程需要几天'));
      if (b) { b.click(); return 'SAMPLE'; }
      return 'NO_SAMPLE';
    })()`,
    returnByValue: true,
  });
  await sleep(8000);

  const c = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('sample-财务制度'));
      if (!b) return 'NO_CHIP';
      b.click(); return 'CHIP_OPEN';
    })()`,
    returnByValue: true,
  });
  console.log('citation:', c.result?.result?.value);
  await sleep(2500);
});
