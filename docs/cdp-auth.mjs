const BASE = 'http://127.0.0.1:9222';
const OUT = 'C:/Users/TIE/WorkBuddy AI/2026-10-22-16-20-01/kb-agent/docs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(path, file, steps) {
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

// 1. 登录页
await session('http://127.0.0.1:3000/login', `${OUT}/shot-login.png`);

// 2. 以 emp 登录后提问敏感问题
await session('http://127.0.0.1:3000/login', `${OUT}/shot-acl.png`, async (send, sleep) => {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('只能看到公开文档'));
      if (!btn) return 'NO_DEMO_BTN';
      btn.click(); return 'LOGIN_CLICKED';
    })()`,
    returnByValue: true,
  });
  console.log('login:', r.result?.result?.value);
  await sleep(5000);

  const ask = await send('Runtime.evaluate', {
    expression: `(() => {
      const ta = document.querySelector('textarea');
      if (!ta) return 'NO_INPUT:' + location.pathname;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'P5 职级的月薪带宽是多少');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'TYPED';
    })()`,
    returnByValue: true,
  });
  console.log('type:', ask.result?.result?.value);
  await sleep(600);

  const sendBtn = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '发送');
      if (!b) return 'NO_SEND';
      b.click(); return 'SENT';
    })()`,
    returnByValue: true,
  });
  console.log('send:', sendBtn.result?.result?.value);
  await sleep(7000);
});
