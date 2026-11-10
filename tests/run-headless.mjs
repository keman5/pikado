// Run the real Canvas/browser suites without touching the user's browser profile.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(join(tmpdir(), 'pikado-test-'));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
const browser = spawn('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', [
  '--headless=new', '--window-size=1440,1000', '--disable-features=msEdgeSyncOnStartup,msEdgeSyncEnabled', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let socket;
async function until(fn, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(250);
  }
  throw new Error('Timed out waiting for browser tests');
}
try {
  await until(async () => fetch('http://127.0.0.1:4175/tests/').then(r => r.ok).catch(() => false));
  const port = await until(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(s => s.split('\n')[0]).catch(() => null));
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(tabs.find(t => t.type === 'page' && t.url === 'about:blank').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') console.error(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  await send('Page.enable');
  await send('Runtime.enable');
  for (const locale of ['en', 'zh-CN']) {
    const init = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear(); localStorage.setItem('pikado.locale', ${JSON.stringify(locale)});` });
    await send('Page.navigate', { url: `http://127.0.0.1:4175/tests/?locale=${locale}` });
    await until(() => evaluate('window.__pikadoTestsDone === true'), 240000);
    const result = await evaluate(`({summary: document.querySelector('#summary').innerText, failures: [...document.querySelectorAll('details.bad')].map(n => n.innerText)})`);
    console.log(`${locale}: ${result.summary}`);
    if (result.failures.length) {
      console.error(result.failures.join('\n'));
      process.exitCode = 1;
    }
    if (process.env.PIKADO_SCREENSHOT) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${process.env.PIKADO_SCREENSHOT}-${locale}.png`, Buffer.from(shot.data, 'base64'));
    }
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: init.identifier });
    await send('Page.navigate', { url: 'about:blank' });
    await until(() => evaluate('location.href === "about:blank"'));
  }
} finally {
  socket?.close();
  for (const child of [browser, server]) {
    if (child.exitCode !== null) continue;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
