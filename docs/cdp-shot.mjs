const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${BASE}/json/new?http://127.0.0.1:3000/`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);

let nextId = 1;
const pending = new Map();
const events = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    events.push(msg.method);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');

// 等首屏 hydration 完成
await sleep(3500);

const clicked = await send('Runtime.evaluate', {
  expression: `(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('报销流程'));
    if (!btns.length) return 'NO_BUTTON';
    btns[0].click();
    return 'CLICKED';
  })()`,
  returnByValue: true,
});
console.log('click:', clicked.result?.result?.value);

// 等流式输出结束（mock 大约 2 秒）
await sleep(5000);

const text = await send('Runtime.evaluate', {
  expression: `(() => {
    const body = document.body.innerText;
    return {
      hasAnswer: body.includes('根据财务制度'),
      hasCitation: body.includes('引用来源'),
      hasDoc: body.includes('sample-财务制度.txt'),
      hasMeta: /\\$0\\.0000|mock\\/deterministic/.test(body),
      snippet: body.slice(body.indexOf('根据财务制度'), body.indexOf('根据财务制度') + 90)
    };
  })()`,
  returnByValue: true,
});
console.log('render:', JSON.stringify(text.result?.result?.value, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync(
  'C:/Users/TIE/WorkBuddy AI/2026-10-22-16-20-01/kb-agent/docs/shot-chat.png',
  Buffer.from(shot.result.data, 'base64'),
);
console.log('screenshot written');

await fetch(`${BASE}/json/close/${target.id}`);
ws.close();
