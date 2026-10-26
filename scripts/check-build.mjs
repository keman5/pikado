import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /lang="zh-CN"/);
assert.match(html, /Pikado 中文版/);
const manifest = JSON.parse(readFileSync('dist/manifest.zh-CN.webmanifest', 'utf8'));
assert.equal(manifest.lang, 'zh-CN');
const englishManifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
assert.equal(englishManifest.lang, 'en');
assert.equal(englishManifest.name, 'Pikado');
assert.doesNotMatch(html, /%APP_/);
for (const match of html.matchAll(/(?:src|href)="\.\/(assets\/[^\"]+)"/g)) {
  assert.ok(statSync(`dist/${match[1]}`).size > 0, `Missing asset: ${match[1]}`);
}
const headers = readFileSync('dist/_headers', 'utf8');
assert.match(headers, /\/sw\.js\n  Cache-Control: no-cache, no-store, must-revalidate/);
for (const name of readdirSync('dist/assets')) {
  assert.ok(statSync(`dist/assets/${name}`).size < 25 * 1024 * 1024, `Cloudflare asset too large: ${name}`);
}
console.log('Localized build, both manifests, entry assets, cache headers and Cloudflare size limits verified.');
