const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(path, file, steps) {
  const target = await (await fetch(`${BASE}/json/new?${path}`, { method: 'PUT' })).json();
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

  if (steps) await steps(send, sleep);

  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const fs = await import('node:fs');
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log('shot:', file);
  await fetch(`${BASE}/json/close/${target.id}`);
  ws.close();
}

const OUT = 'C:/Users/TIE/WorkBuddy AI/2026-10-22-16-20-01/kb-agent/docs';

await shot('http://127.0.0.1:3000/', `${OUT}/shot-chat.png`, async (send, sleep) => {
  const click = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('报销流程需要几天'));
      if (!b) return 'NO_SAMPLE';
      b.click(); return 'OK';
    })()`,
    returnByValue: true,
  });
  console.log('sample:', click.result?.result?.value);
  await sleep(7000);

  const expand = await send('Runtime.evaluate', {
    expression: `(() => {
      const rows = [...document.querySelectorAll('button')].filter(x => x.textContent.includes('sample-财务制度'));
      if (!rows.length) return 'NO_CITATION';
      rows[0].click(); return 'EXPANDED';
    })()`,
    returnByValue: true,
  });
  console.log('citation:', expand.result?.result?.value);
  await sleep(2500);
});

await shot('http://127.0.0.1:3000/metrics', `${OUT}/shot-metrics.png`);
