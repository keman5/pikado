import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import en from '../src/i18n/locales/en.js';
import zhCN from '../src/i18n/locales/zh-CN.js';
import { translate, normalizeLocale } from '../src/i18n/index.js';

test('both catalogs have matching keys and interpolation arguments', () => {
  assert.deepEqual(Object.keys(zhCN).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    const args = value => [...value.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(args(zhCN[key]), args(en[key]), key);
    assert.ok(zhCN[key].length > 0, key);
  }
});

test('all Chinese interface strings live in locale resources', () => {
  for (const file of readdirSync(new URL('../src', import.meta.url), { recursive: true })) {
    if (!file.endsWith('.js') || file.startsWith('i18n/locales/')) continue;
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /\p{Script=Han}/u, file);
  }
  for (const file of ['index.html', 'public/manifest.webmanifest']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /\p{Script=Han}/u, file);
  }
});

test('translation preserves identifiers, unknown text and literal user arguments', () => {
  assert.equal(translate('zh-CN', 'Move Tool'), '移动工具');
  assert.equal(translate('en', 'Move Tool'), 'Move Tool');
  assert.equal(translate('zh-CN', 'Box Blur'), '方框模糊');
  assert.equal(translate('en', 'Box Blur'), 'Box Blur');
  for (const key of ['multiply', 'My family photo.psd', '自定义图层', 'toString', '__proto__', 'constructor']) {
    assert.equal(translate('zh-CN', key), key);
  }
  assert.equal(translate('zh-CN', 'Saved {0}', 'File {1} $& <name>.psd'), '已保存 File {1} $& <name>.psd');
  assert.equal(translate('en', 'New {0} × {1} document', 800, 600), 'New 800 × 600 document');
  assert.equal(translate('zh-CN', 'New {0} × {1} document', 800, 600), '新建 800 × 600 文档');
  assert.equal(translate('zh-CN', 'Saved {0}'), '已保存 {0}');
  assert.equal(translate('zh-CN', null), null);
  assert.equal(normalizeLocale('constructor'), 'zh-CN');
  assert.equal(normalizeLocale('en'), 'en');
});

test('saved language takes effect on next load and denied storage falls back safely', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let value = 'en';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => value, setItem: (_key, next) => { value = next; },
  } });
  try {
    const english = await import('../src/i18n/index.js?test=en');
    assert.equal(english.getLocale(), 'en');
    assert.equal(english.t('Cancel'), 'Cancel');
    english.saveLocale('zh-CN');
    assert.equal(english.getLocale(), 'en');
    const chinese = await import('../src/i18n/index.js?test=zh');
    assert.equal(chinese.t('Cancel'), '取消');
    assert.throws(() => chinese.saveLocale('de'));
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    const blocked = await import('../src/i18n/index.js?test=blocked');
    assert.equal(blocked.getLocale(), 'zh-CN');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('locked layer feedback is translated without changing user layer names', () => {
  assert.equal(translate('zh-CN', 'The layer is locked and cannot be moved.'), '图层已锁定，无法移动。');
  assert.equal(translate('zh-CN', 'Layer "{0}" is locked.', 'My File {1} $&'), '图层“My File {1} $&”已锁定。');
  assert.equal(translate('en', 'Layer "{0}" is locked.', 'My File {1} $&'), 'Layer "My File {1} $&" is locked.');
});


test('dynamic layer menu actions are available in both languages', () => {
  const labels = {
    'Duplicate Layers': '复制图层', 'Delete Layers': '删除图层',
    'Release Clipping Mask': '释放剪贴蒙版',
    'Disable Layer Mask': '禁用图层蒙版', 'Enable Layer Mask': '启用图层蒙版',
    'Disable': '禁用', 'Enable': '启用',
  };
  for (const [key, chinese] of Object.entries(labels)) {
    assert.equal(translate('zh-CN', key), chinese);
    assert.equal(translate('en', key), key);
  }
});
