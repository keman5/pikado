import { suite } from '../harness.js';
import { createRasterLayer, Layer } from '/src/core/layer.js';
import { createCanvas } from '/src/core/util.js';
import { layerBounds } from '/src/core/layer-bounds.js';
import { compositeDocument, setLayerPreview, clearLayerPreviews } from '/src/render/compositor.js';
import { toggleMaskEnabled } from '/src/layers/ops.js';
import { nudgeLayers, alignLayers } from '/src/tools/move.js';
import { savePKD, loadPKD } from '/src/io/pkd.js';
import { writePSD } from '/src/io/psd-write.js';
import { readPSD } from '/src/io/psd-read.js';
import { openFile, pickFiles } from '/src/io/open.js';
import { saveDocument, saveDocumentAs } from '/src/io/save.js';
import { getCommand, isEnabled } from '/src/commands/registry.js';

function drag(app, dx, dy) {
  const event = { x: 10, y: 10, sx: -100, sy: -100, button: 0, ctrlKey: false, metaKey: false, shiftKey: false };
  app.tool.onPointerDown(event);
  app.tool.onPointerMove({ ...event, x: 10 + dx, y: 10 + dy });
  app.tool.onPointerUp(event);
}

suite('regression / moves preserve off-canvas pixels, masks, history and file round trips', async t => {
  const app = t.app;
  const doc = t.doc(32, 24, '#ffffff', 'off canvas');
  const layer = createRasterLayer(32, 24, 'pixels');
  t.fill(layer, '#ff6600', 4, 3, 20, 18);
  layer.addMask(32, 24);
  layer.mask.getContext('2d').clearRect(4, 3, 3, 6);
  layer.touchMask();
  layer.blendMode = 'linear-light';
  layer.fillOpacity = 0.8;
  doc.addLayer(layer);
  doc.setActiveLayer(layer.id);
  doc.commit('fixture');
  const bytes = new Uint8ClampedArray(t.bytes(compositeDocument(doc)));
  const snap = app.snap;
  app.setTool('move');
  const options = { ...app.tool.state };
  app.tool.state.autoSelect = false;
  app.tool.state.showTransform = false;
  app.snap = false;
  try {
    for (const [dx, dy] of [[0, 22], [0, -22], [30, 0], [-30, 0], [70, 50], [-70, -50]]) {
      drag(app, dx, dy);
      compositeDocument(doc);
      // Menu enablement and thumbnails must not destroy canonical pixels.
      isEnabled('edit.copy'); isEnabled('layer.mask.apply');
      layer.thumbnail(28);
      t.eq(t.inked(layer.pixelKey()), 360, 'moving and rendering never discards source pixels');
    }
    t.eq(t.mad(bytes, t.bytes(compositeDocument(doc))), 0, 'all edges return to byte-identical composite');
    drag(app, -45, 40);
    toggleMaskEnabled(doc, layer); toggleMaskEnabled(doc, layer);
    t.ok(layer.maskTile, 'toggling mask visibility preserves its off-canvas data');
    for (const [encode, decode, name] of [[savePKD, loadPKD, 'PKD'], [writePSD, readPSD, 'PSD']]) {
      const reopened = await decode(await (await encode(doc)).arrayBuffer());
      const restored = reopened.layers.find(l => l.name === 'pixels');
      t.eq(restored.contentBounds(), { x: -41, y: 43, width: 20, height: 18 }, `${name} keeps off-canvas bounds`);
      t.eq(t.inked(restored.pixelKey()), 360, `${name} keeps hidden pixels`);
      reopened.setActiveLayer(restored.id);
      nudgeLayers(reopened, 45, -40);
      t.close(t.mad(bytes, t.bytes(compositeDocument(reopened))), 0, 0.5, `${name} brings linked mask and image back`);
    }
    doc.history.undo(); doc.history.undo();
    t.ok(doc.history.undo(), 'undo returns from off-canvas');
    t.eq(t.mad(bytes, t.bytes(compositeDocument(doc))), 0, 'undo restores all pixels');
    t.ok(doc.history.redo(), 'redo reapplies movement');
    drag(app, 45, -40);
    t.eq(t.mad(bytes, t.bytes(compositeDocument(doc))), 0, 'moving back after redo restores all pixels');
    const base = { x: 10, y: 10, sx: -100, sy: -100, button: 0 };
    app.tool.onPointerDown(base);
    app.tool.onPointerMove({ ...base, x: 90, y: -30 });
    app.tool.cancel();
    t.eq(t.mad(bytes, t.bytes(compositeDocument(doc))), 0, 'cancel restores pixels and linked mask');
    const l = doc.activeLayer();
    l.maskLinked = false;
    const mask = new Uint8ClampedArray(t.bytes(l.readMask()));
    nudgeLayers(doc, 0, 60); nudgeLayers(doc, 0, -60);
    t.eq(t.mad(mask, t.bytes(l.readMask())), 0, 'unlinked mask stays fixed');
    alignLayers(doc, 'bottom');
    t.eq(layerBounds(doc.activeLayer()).y, 6, 'alignment uses full bounds after translation');
  } finally {
    Object.assign(app.tool.state, options);
    app.snap = snap;
  }
});

suite('regression / tile bounds, previews and transform toggle invalidate immediately', t => {
  const cv = createCanvas(8, 8);
  cv.getContext('2d').fillRect(0, 0, 8, 8);
  const layer = new Layer().setTile(cv, -20, 30, 32, 24);
  t.eq(layerBounds(layer).x, -20, 'initial tile bounds');
  layer.setTile(cv, 5, 7, 32, 24);
  t.eq(layerBounds(layer).x, 5, 'same pixels at new offset invalidate bounds');
  const doc = t.doc(32, 24, '#ffffff');
  doc.addLayer(layer);
  const preview = createCanvas(32, 24);
  preview.getContext('2d').fillStyle = '#ff0000';
  preview.getContext('2d').fillRect(0, 0, 32, 24);
  setLayerPreview(layer.id, preview);
  try { t.eq(t.px(compositeDocument(doc), 2, 2), '255,0,0,255', 'compact layer displays preview'); }
  finally { clearLayerPreviews(layer.id); }
  t.app.setTool('move');
  const render = t.app.requestRender;
  const previous = t.app.tool.state.showTransform;
  let renders = 0;
  t.app.requestRender = () => { renders++; };
  try {
    t.app.tool.setOption('showTransform', true);
    t.ok(renders > 0, 'checking Show Transform Controls schedules rendering immediately');
    t.ok(t.app.tool.boxHandles(t.app.viewport), 'selected layer exposes transform handles');
  } finally { t.app.requestRender = render; t.app.tool.setOption('showTransform', previous); }
});

async function answerSave(doc, replace) {
  const pending = saveDocument(doc);
  const dialog = document.querySelector('.pk-dialog-overlay');
  if (!dialog) throw new Error('Missing overwrite confirmation');
  dialog.querySelector(replace ? '.danger' : '.subtle').click();
  return pending;
}

suite('regression / original image save confirms, retains format and aborts failed writes', async t => {
  const seed = t.doc(8, 8, '#ff0000', 'source');
  const png = await new Promise(resolve => seed.activeLayer().canvas.toBlob(resolve));
  let written, writes = 0, aborted = 0;
  const file = new File([png], 'source.png', { type: 'image/png' });
  file.handle = { name: 'source.png', createWritable: async () => ({
    write: async blob => { written = blob; writes++; }, close: async () => {}, abort: async () => { aborted++; },
  }) };
  const opened = await openFile(file);
  try {
    t.is(opened.fileHandle, file.handle, 'opening a bitmap retains its writable handle');
    t.eq(opened.filePath, 'source.png', 'source extension is retained');
    opened.touch();
    t.notOk(await answerSave(opened, false), 'cancel declines replacement');
    t.eq(writes, 0, 'cancel never opens or writes the source');
    t.ok(opened.dirty, 'cancel keeps unsaved state');
    t.ok(await answerSave(opened, true), 'confirmed replacement succeeds');
    t.eq(written.type, 'image/png', 'original PNG stays PNG');
    file.handle.name = 'source.jpg';
    t.ok(await answerSave(opened, true), 'JPEG replacement succeeds');
    t.eq(written.type, 'image/jpeg', 'JPEG is not silently replaced by PSD or PNG');
    file.handle.name = 'source.svg';
    t.ok(await answerSave(opened, true), 'SVG MIME parameters are accepted');
    t.ok(written.type.startsWith('image/svg+xml'), 'SVG retains its format');
    file.handle.name = 'source.jpg';
    const desc = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
    let suggested;
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async opts => {
      suggested = opts.suggestedName; throw new DOMException('cancel', 'AbortError');
    } });
    try {
      t.notOk(await saveDocumentAs(opened), 'picker cancellation is respected');
      t.eq(suggested, 'source.jpg', 'Save As retains source extension');
    } finally {
      if (desc) Object.defineProperty(window, 'showSaveFilePicker', desc); else delete window.showSaveFilePicker;
    }
    opened.touch();
    file.handle.createWritable = async () => ({ write: async () => { throw new Error('Disk full'); }, abort: async () => { aborted++; } });
    t.notOk(await answerSave(opened, true), 'failed write reports failure');
    t.eq(aborted, 1, 'failed stream is aborted');
    t.ok(opened.dirty, 'failed write preserves unsaved state');
  } finally { t.app.closeDocument(opened); }
});

suite('regression / Save As intercepts the original shortcut even in a focused input', async t => {
  t.doc(8, 8, '#ffffff');
  const command = getCommand('file.save-as');
  const original = command.run;
  let saves = 0;
  command.run = () => { saves++; };
  const input = document.createElement('input');
  document.body.append(input);
  try {
    t.eq(command.accel, 'Shift+Ctrl+S', 'original shortcut is preserved');
    const event = new KeyboardEvent('keydown', { key: 'S', code: 'KeyS', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    t.ok(event.defaultPrevented, 'browser default is cancelled in capture phase');
    t.eq(saves, 1, 'Save As is dispatched exactly once');
    await Promise.resolve();
  } finally { command.run = original; input.remove(); }
});

suite('regression / transform preserves off-canvas surfaces and cancel restores the originals', async t => {
  const { startTransform, setTransformNumeric, getTransformNumeric, commitTransform, cancelTransform } = await import('/src/tools/transform.js');
  const doc = t.doc(32, 24, '#ffffff');
  const layer = createRasterLayer(32, 24, 'transform pixels');
  t.fill(layer, '#ff6600', 4, 3, 20, 18);
  layer.addMask(32, 24);
  doc.addLayer(layer);
  doc.setActiveLayer(layer.id);
  const before = new Uint8ClampedArray(t.bytes(compositeDocument(doc)));
  nudgeLayers(doc, -40, 50);
  const offscreen = layer.contentBounds();
  t.ok(startTransform(doc), 'off-canvas layer can enter transform');
  let current = getTransformNumeric();
  setTransformNumeric({ x: current.x + 80, y: current.y - 100 });
  cancelTransform();
  t.eq(layer.contentBounds(), offscreen, 'cancel restores off-canvas source rectangle');
  t.eq(t.inked(layer.pixelKey()), 360, 'cancel keeps hidden source pixels');
  startTransform(doc);
  current = getTransformNumeric();
  setTransformNumeric({ x: current.x + 40, y: current.y - 50 });
  commitTransform();
  t.eq(t.mad(before, t.bytes(compositeDocument(doc))), 0, 'transform returns image and linked mask intact');
  startTransform(doc);
  await t.throws(() => setTransformNumeric({ width: 1e9 }), 'oversized transforms are rejected before allocating');
  cancelTransform();
  layer.locked.position = true;
  t.notOk(startTransform(doc), 'position-locked layers cannot start a transform');
});

suite('regression / nudges after undo or another edit remain independently undoable', t => {
  const doc = t.doc(32, 24, '#ffffff');
  const layer = createRasterLayer(32, 24, 'nudge pixels');
  t.fill(layer, '#ff0000', 3, 3, 4, 4);
  doc.addLayer(layer);
  doc.setActiveLayer(layer.id);
  doc.commit('fixture');
  nudgeLayers(doc, 1, 0);
  doc.history.undo();
  nudgeLayers(doc, 0, 1);
  t.notOk(doc.history.canRedo, 'a nudge after undo discards the abandoned redo branch');
  doc.history.undo();
  t.eq(doc.activeLayer().contentBounds(), { x: 3, y: 3, width: 4, height: 4 }, 'undo returns to the real pre-nudge state');
  nudgeLayers(doc, 1, 0);
  doc.activeLayer().opacity = 0.5;
  doc.commit('opacity');
  nudgeLayers(doc, 1, 0);
  doc.history.undo();
  t.eq(doc.activeLayer().contentBounds().x, 4, 'nudge does not overwrite a different intervening edit');
  t.eq(doc.activeLayer().opacity, 0.5, 'intervening opacity edit survives');
});

suite('regression / open picker preserves source handles and unsupported encoders cannot overwrite', async t => {
  const seed = t.doc(8, 8, '#123456');
  const png = await new Promise(resolve => seed.activeLayer().canvas.toBlob(resolve));
  const original = Object.getOwnPropertyDescriptor(window, 'showOpenFilePicker');
  const file = new File([png], 'picked.png', { type: 'image/png' });
  let writes = 0;
  const handle = { name: 'picked.png', getFile: async () => file, createWritable: async () => { writes++; return {}; } };
  Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: async () => [handle] });
  let opened;
  try {
    await pickFiles();
    opened = t.app.activeDoc;
    t.is(opened.fileHandle, handle, 'File > Open preserves the source handle');
    const blobEncoder = HTMLCanvasElement.prototype.toBlob;
    handle.name = 'picked.webp';
    opened.touch();
    HTMLCanvasElement.prototype.toBlob = function (cb) { return blobEncoder.call(this, cb, 'image/png'); };
    try {
      t.notOk(await answerSave(opened, true), 'a browser MIME fallback fails original-file save');
      t.eq(writes, 0, 'PNG bytes never reach a WebP source');
      t.ok(opened.dirty, 'encoder failure preserves unsaved state');
    } finally { HTMLCanvasElement.prototype.toBlob = blobEncoder; }
  } finally {
    if (opened) t.app.closeDocument(opened);
    if (original) Object.defineProperty(window, 'showOpenFilePicker', original); else delete window.showOpenFilePicker;
  }
});

suite('regression / floating selection pixels survive an off-canvas move', t => {
  const doc = t.doc(32, 24, '#ffffff');
  const layer = createRasterLayer(32, 24, 'selection');
  t.fill(layer, '#ff0000', 3, 3, 4, 4);
  doc.addLayer(layer);
  doc.setActiveLayer(layer.id);
  doc.selection.set(new Uint8ClampedArray(32 * 24).fill(255));
  t.app.setTool('move');
  const tool = t.app.tool;
  const original = { ...tool.state }, snap = t.app.snap;
  tool.state.autoSelect = false; tool.state.showTransform = false; t.app.snap = false;
  try {
    const e = { x: 5, y: 5, sx: -100, sy: -100, ctrlKey: true, button: 0 };
    tool.onPointerDown(e);
    tool.onPointerMove({ ...e, x: 5, y: 55 });
    tool.onPointerUp(e);
    t.eq(t.inked(layer.pixelKey()), 16, 'selected pixels remain outside the canvas');
    doc.selection.clear();
    nudgeLayers(doc, 0, -50);
    t.eq(layer.contentBounds(), { x: 3, y: 3, width: 4, height: 4 }, 'the layer can bring those pixels back');
  } finally { Object.assign(tool.state, original); t.app.snap = snap; }
});

suite('regression / project loader rejects invalid tile coordinates', async t => {
  const doc = t.doc(8, 8, '#ffffff');
  doc.activeLayer().setTile(createCanvas(2, 2), NaN, 0, 8, 8);
  const bytes = await (await savePKD(doc)).arrayBuffer();
  await t.throws(() => loadPKD(bytes), 'malformed tile coordinates cannot reach the renderer');
});
