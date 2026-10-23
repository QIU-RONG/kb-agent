const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`${BASE}/json/new?http://127.0.0.1:3000/traces`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = id++;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await sleep(4000);

const click = await send('Runtime.evaluate', {
  expression: `(() => {
    const rows = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('展开'));
    if (!rows.length) return 'NO_ROW:' + document.body.innerText.slice(0, 120);
    rows[0].click();
    return 'CLICKED';
  })()`,
  returnByValue: true,
});
console.log('click:', click.result?.result?.value);

await sleep(3000);

const check = await send('Runtime.evaluate', {
  expression: `(() => {
    const t = document.body.innerText;
    return {
      hasSpanLabels: ['查询改写','向量检索','相关性判分','生成回答'].filter(k => t.includes(k)),
      hasVerdict: t.includes('verdicts') || t.includes('LLM判分') || t.includes('阈值'),
      hasAnswer: t.includes('最终回答'),
      len: t.length
    };
  })()`,
  returnByValue: true,
});
console.log('render:', JSON.stringify(check.result?.result?.value));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
const fs = await import('node:fs');
fs.writeFileSync(
  'C:/Users/TIE/WorkBuddy AI/2026-10-22-16-20-01/kb-agent/docs/shot-traces.png',
  Buffer.from(shot.result.data, 'base64'),
);
console.log('screenshot written');

await fetch(`${BASE}/json/close/${target.id}`);
ws.close();
