'use strict';
// Generate a narrowly scoped compatibility patch for an already-running index
// closure. This file never connects to QQ or writes user settings when run.
const fs = require('node:fs');
const path = require('node:path');

function installBubbleScaleCompatibility() {
  window.__liuliBubbleScaleCompatibility?.dispose();
  const KEY = 'liuli-dsh-settings';
  const CONTROL = 'input[data-liuli-setting="bubbleScale"][data-liuli-scale-compat-control]';
  const PANEL = '#liuli-embedded, #liuli-settings-dialog, .liuli-embedded, .liuli-panel, .liuli-field, [data-liuli-setting]';
  let frame = 0;
  let disposed = false;
  let controlsDirty = true;
  const fields = new Set();
  const controls = new Set();
  function normalized(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(80, Math.min(140, number)) : 100;
  }
  function storedSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function currentScale() {
    const cache = window.__liuliSettingsCache;
    return normalized(cache?.bubbleScale ?? storedSettings().bubbleScale ?? 100);
  }
  function applyScale() {
    const value = currentScale();
    const ratio = String(value / 100);
    if (document.body.style.getPropertyValue('--ll-bubble-scale') !== ratio)
      document.body.style.setProperty('--ll-bubble-scale', ratio);
    if (document.body.hasAttribute('data-liuli-scaled-bubbles') !== (value !== 100))
      document.body.toggleAttribute('data-liuli-scaled-bubbles', value !== 100);
    for (const input of controls) {
      if (!input.isConnected) { controls.delete(input); continue; }
      input.value = String(value);
      const percentage = (value - 80) / 60 * 100 + '%';
      if (input.style.getPropertyValue('--liuli-pct') !== percentage)
        input.style.setProperty('--liuli-pct', percentage);
      const caption = input.closest('[data-liuli-scale-compat]')?.querySelector('.liuli-field__value');
      if (caption && caption.textContent !== value + '%') caption.textContent = value + '%';
    }
  }
  function persist(event) {
    const value = normalized(event.currentTarget.value);
    // Read at the input boundary. Keep the live cache object and merge only the
    // latest saved fields before editing this one value, preserving other choices.
    const cache = window.__liuliSettingsCache;
    const settings = cache && typeof cache === 'object' ? cache : {};
    Object.assign(settings, storedSettings());
    settings.bubbleScale = value;
    window.__liuliSettingsCache = settings;
    const serialized = JSON.stringify(settings);
    localStorage.setItem(KEY, serialized);
    // The running index owns all ordinary settings effects and its panel models.
    window.dispatchEvent(new StorageEvent('storage', {
      key: KEY, newValue: serialized, storageArea: localStorage, url: location.href
    }));
    applyScale();
    window.__liuliVoiceLayout?.refresh();
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function buildBefore(widthInput) {
    const widthField = widthInput.closest('.liuli-field');
    if (!widthField || widthField.previousElementSibling?.hasAttribute('data-liuli-scale-compat-hint')) return;
    const field = element('div', 'liuli-field');
    field.setAttribute('data-liuli-scale-compat', '');
    const row = element('div', 'liuli-field__row');
    row.append(element('div', 'liuli-field__label', '气泡大小'), element('div', 'liuli-field__value'));
    const input = element('input', 'liuli-slider');
    input.type = 'range'; input.min = '80'; input.max = '140'; input.step = '5';
    input.dataset.liuliSetting = 'bubbleScale'; input.dataset.unit = '%';
    input.setAttribute('data-liuli-scale-compat-control', '');
    input.addEventListener('input', persist);
    controls.add(input);
    field.append(row, input);
    const hint = element('div', 'liuli-field__hint', '调整气泡留白和语音自然尺寸；文字字号、图片大小与最大宽度分别设置。');
    hint.setAttribute('data-liuli-scale-compat-hint', '');
    widthField.before(field, hint);
    fields.add(field); fields.add(hint);
  }
  function flush() {
    frame = 0;
    if (disposed) return;
    if (controlsDirty) {
      controlsDirty = false;
      const nativeControl = document.querySelector('input[data-liuli-setting="bubbleScale"]:not([data-liuli-scale-compat-control])');
      if (nativeControl) {
        for (const field of fields) field.remove();
        fields.clear(); controls.clear();
      } else {
        for (const field of fields) if (!field.isConnected) fields.delete(field);
        document.querySelectorAll('input[data-liuli-setting="bubbleMaxWidth"]').forEach(buildBefore);
      }
    }
    applyScale();
  }
  function sync() { controlsDirty = true; flush(); }
  function schedule(checkControls = false) {
    if (checkControls) controlsDirty = true;
    if (!disposed && !frame) frame = requestAnimationFrame(flush);
  }
  function storage(event) { if (event.key === KEY) schedule(); }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target === document.body) schedule();
      } else if (record.target.closest?.(PANEL) ||
        [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && node.matches(PANEL))) {
        schedule(true);
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  window.addEventListener('storage', storage);
  window.__liuliBubbleScaleCompatibility = { sync, dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame); frame = 0;
    observer.disconnect(); window.removeEventListener('storage', storage);
    for (const field of fields) field.remove();
    fields.clear(); controls.clear();
    delete window.__liuliBubbleScaleCompatibility;
  } };
  sync();
  return { scale: currentScale(), controls: document.querySelectorAll(CONTROL).length };
}

const source = '(' + installBubbleScaleCompatibility.toString() + ')();\n';
module.exports = { source };
if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../output/playwright/responsive-motion-20261113/bubble-scale-compat.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, source);
  console.log(output);
}
