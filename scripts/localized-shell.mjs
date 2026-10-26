import { readFileSync } from 'node:fs';
import zhCN from '../src/i18n/locales/zh-CN.js';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const chineseManifest = JSON.stringify({ ...manifest, name: zhCN.Pikado, lang: 'zh-CN',
  description: zhCN[manifest.description] }, null, 2);

export function localizedShell() {
  return {
    name: 'localized-shell',
    transformIndexHtml(html) {
      return html.replace(/%APP_(TITLE|DESCRIPTION|NOSCRIPT)%/g, (_, key) => zhCN[{
        TITLE: 'Pikado — Image Studio',
        DESCRIPTION: 'Free online image editor with layers, masks, PSD, filters and offline editing. Images are processed on your device.',
        NOSCRIPT: 'Pikado needs JavaScript enabled.',
      }[key]]);
    },
    configureServer(server) {
      server.middlewares.use('/manifest.zh-CN.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(chineseManifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.zh-CN.webmanifest', source: chineseManifest });
    },
  };
}
