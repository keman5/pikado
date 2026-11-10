import { suite } from '../harness.js';
import { t as text, getLocale } from '/src/i18n/index.js';
import { createRasterLayer } from '/src/core/layer.js';
import { commands, labelOf } from '/src/commands/registry.js';
import { openPanel, refreshPanel, closeMenu } from '/src/ui/panel-host.js';
import { showCanvasMenu } from '/src/ui/canvas-menu.js';
import { confirmDialog } from '/src/ui/dialog.js';

suite('localization / rendered layer menus follow selection, mask and clipping state', async t => {
  const doc = t.doc(24, 24, '#fff', 'Menu {0} $&');
  const layer = createRasterLayer(24, 24, 'Normal');
  t.fill(layer, '#f00');
  doc.addLayer(layer);
  openPanel('layers');
  const show = async () => {
    refreshPanel('layers');
    await new Promise(r => setTimeout(r, 60));
    const row = [...document.querySelectorAll('.pk-lay-row')].find(n => n._item?.layer === layer);
    t.ok(row, 'layer row exists');
    row.querySelector('.pk-lay-main').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    return [...document.querySelectorAll('.pk-menu-label')].map(n => n.textContent);
  };
  try {
    let labels = await show();
    t.ok(labels.includes(text('Duplicate Layer')), 'single-layer action is localized');
    t.ok(labels.includes(text('Add Layer Mask')), 'add-mask action is localized');
    layer.addMask(24, 24);
    layer.clipped = true;
    doc.selectedLayerIds = doc.layers.map(l => l.id);
    labels = await show();
    for (const key of ['Duplicate Layers', 'Delete Layers', 'Apply Layer Mask', 'Disable Layer Mask', 'Release Clipping Mask']) {
      t.ok(labels.includes(text(key)), `rendered ${key}`);
    }
    t.eq(labelOf('layer.mask.toggle'), text('Disable'), 'command mask state is localized');
    t.eq(labelOf('layer.clipping'), text('Release Clipping Mask'), 'command clipping state is localized');
    layer.maskEnabled = false;
    labels = await show();
    t.ok(labels.includes(text('Enable Layer Mask')), 'disabled mask changes the translated action');
    t.app.setTool('move');
    showCanvasMenu({ x: 10, y: 10 }, { clientX: 100, clientY: 100 });
    labels = [...document.querySelectorAll('.pk-menu-label')].map(n => n.textContent);
    t.ok(labels.includes('Normal'), 'user layer name matching a dictionary key stays literal');
    t.eq(layer.name, 'Normal', 'layer data remains untouched');
    if (getLocale() === 'zh-CN') {
      const untranslated = [...commands.keys()].filter(id => !id.startsWith('file.open-recent.'))
        .map(id => [id, labelOf(id)]).filter(([, label]) => /[a-z]{3}/i.test(label) && !/\p{Script=Han}/u.test(label));
      t.eq(untranslated, [], 'command captions have Chinese text');
    }
  } finally { closeMenu(); }
});

suite('localization / confirmation button and interpolated document names', async t => {
  const name = 'Cancel {1} $& <family>.psd';
  const result = confirmDialog(text('"{0}" has unsaved changes. Close it anyway?', name), 'Close', 'Discard');
  const dialog = [...document.querySelectorAll('.pk-dialog')].at(-1);
  t.ok(dialog.querySelector('.pk-msg').textContent.includes(name), 'document name stays literal');
  t.eq(dialog.querySelector('.pk-dialog-footer .primary').textContent, text('Discard'), 'caller-supplied confirmation button is localized');
  dialog.querySelector('.pk-dialog-close').click();
  await result;
});
