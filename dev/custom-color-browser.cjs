'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/custom-color-design-20261113'));
fs.mkdirSync(out, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const extract = name => {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  }', start);
  assert(start >= 0 && end > start, name);
  return source.slice(start, end + 4);
};
const paletteSource = source.slice(source.indexOf('  const SURFACE_TONES ='), source.indexOf('  let paletteGeneration ='));
const markup = `<!doctype html><style>${read('assets/panel.css')}
body{margin:0;padding:28px;box-sizing:border-box;min-height:100vh;font:13px/1.5 'Microsoft YaHei',sans-serif;background:#1b211c;color:var(--ll-on-glass)}
*{box-sizing:border-box}.frame{max-width:700px;margin:auto;padding:22px;border-radius:22px;background:rgba(var(--ll-acrylic),.65);border:1px solid rgba(var(--ll-on-glass-rgb),.1)}
.title{font-size:18px;font-weight:600}.subtitle{color:var(--ll-on-glass-2);margin:3px 0 12px}.liuli-field__hint{color:var(--ll-on-glass-2);font-size:11px;margin:4px 0}
</style><body><div class="frame"><div class="title">配色</div><div class="subtitle">从一种颜色，生成属于你的主题。</div><main id="host"></main></div></body>`;
const harness = `(() => {
const {loadRoles,roleVars,accentPalette,buildRoleControls} = window.LiuliRoles;
const DEFAULT_SOURCE='#1d9bf0';let llModeCfg={colorSource:'custom',customColor:'#4bf11e'};
let refreshPaletteInfo=()=>{};let llColorControlInstance=0;
${paletteSource}
${extract('llNormalizeColorSeed')}
${extract('llSyncColorSourceControls')}
${extract('buildColorControls')}
window.settings=llModeCfg;window.writes=[];window.dark=true;
function applyDynamicPalette(){const mcu=window.LiuliMCU;const seed=llModeCfg.colorSource==='custom'?llModeCfg.customColor:'#bd8749';const theme=mcu.themeFromSourceColor(mcu.argbFromHex(seed));const roles=loadRoles();for(const[k,v]of Object.entries({...deriveVars(mcu,theme,window.dark,roles),...roleVars(mcu,theme,window.dark,roles)}))if(v===null)document.body.style.removeProperty(k);else document.body.style.setProperty(k,v);document.body.dataset.liuliSource=seed;refreshPaletteInfo();}
function applySettings(next,broadcast){llModeCfg=next;if(broadcast)window.writes.push(JSON.parse(JSON.stringify(next)));for(const b of document.querySelectorAll('[data-liuli-setting="colorSource"] button'))b.classList.toggle('is-active',b.dataset.settingValue===llModeCfg.colorSource);llSyncColorSourceControls();applyDynamicPalette();}
applyDynamicPalette();buildColorControls(document.querySelector('#host'),window.settings);
window.setTheme=dark=>{window.dark=dark;applyDynamicPalette();};
window.addSecondPanel=()=>{const host=document.createElement('div');host.id='second-host';document.body.appendChild(host);buildColorControls(host,window.settings);};
window.paletteSnapshot=()=>[...document.querySelectorAll('.liuli-palette-role')].map(item=>({name:item.querySelector('.liuli-palette-role__name').textContent,background:getComputedStyle(item.querySelector('.liuli-palette-role__sample')).backgroundColor,foreground:getComputedStyle(item.querySelector('.liuli-palette-role__sample')).color,hex:[...item.querySelectorAll('code')].map(x=>x.textContent),label:item.getAttribute('aria-label')}));
})();`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production color controls, role controls, deriveVars and MCU in isolated Chromium; no live QQ/config writes', checks: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 1300 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(markup);
    await page.addScriptTag({ content: read('assets/mcu.js') });
    await page.addScriptTag({ content: read('renderer/color-roles.js') });
    await page.addScriptTag({ content: harness });
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    assert.equal(await page.locator('.liuli-palette-role').count(), 8);
    assert.equal(await page.locator('.liuli-roles-row').count(), 4);
    assert.equal(await page.locator('.liuli-roles-seg button').count(), 16);
    report.initial = await page.evaluate(() => paletteSnapshot());
    for (const sample of report.initial) {
      assert.equal(sample.hex.length, 2);
      assert(sample.hex.every(value => /^#[\dA-F]{6}( · \d+%)?$/.test(value)), JSON.stringify(sample));
    }
    assert.notEqual(report.initial[2].background, report.initial[3].background);
    assert(report.initial[7].hex[0].endsWith('86%'), 'Neutral other bubble must show its actual translucent fallback');
    report.checks.push('Opening preserves settings and displays eight actual role pairs with HEX, including distinct secondary and tertiary colors; all four role controls remain.');
    await page.screenshot({ path: path.join(out, 'custom-dark.png'), fullPage: true });
    await page.getByRole('textbox', { name: '基础颜色十六进制值' }).fill('#9865ef');
    report.changed = await page.evaluate(() => ({ seed: settings.customColor, palette: paletteSnapshot(), swatch: getComputedStyle(document.querySelector('.liuli-color-selected')).backgroundColor }));
    assert.equal(report.changed.seed, '#9865ef');
    assert.notEqual(report.changed.palette[0].background, report.initial[0].background);
    assert.equal(report.changed.swatch, 'rgb(152, 101, 239)');
    report.checks.push('Valid HEX input updates the seed swatch and real MCU role pairs immediately.');
    const writes = await page.evaluate(() => window.writes.length);
    await page.getByRole('textbox', { name: '基础颜色十六进制值' }).fill('#zz0000');
    assert.equal(await page.getByRole('textbox', { name: '基础颜色十六进制值' }).getAttribute('aria-invalid'), 'true');
    assert(await page.locator('[data-liuli-color-error]').textContent());
    assert.equal(await page.evaluate(() => window.writes.length), writes);
    report.checks.push('Invalid HEX keeps the applied palette unchanged and reports an accessible inline error.');
    await page.getByRole('textbox', { name: '基础颜色十六进制值' }).fill('#9865ef');
    assert.equal(await page.locator('input[type=color]').count(), 0);
    const ring = await page.getByRole('slider', { name: '色相', exact: true }).boundingBox();
    const center = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 };
    const continuous = [];
    await page.mouse.move(center.x, ring.y + 8);
    await page.mouse.down();
    for (const angle of [0, 55, 120, 185, 250, 315]) {
      const radians = (angle - 90) * Math.PI / 180;
      await page.mouse.move(center.x + Math.cos(radians) * 90, center.y + Math.sin(radians) * 90, { steps: 3 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      continuous.push(await page.evaluate(() => ({ seed: settings.customColor, brand: getComputedStyle(document.querySelector('.liuli-palette-role__sample')).backgroundColor, hex: document.querySelector('.liuli-palette-role code').textContent })));
    }
    await page.mouse.up();
    assert(new Set(continuous.map(x => x.brand)).size >= 5, JSON.stringify(continuous));
    report.continuousHue = continuous;
    const square = await page.getByRole('slider', { name: '饱和度与亮度', exact: true }).boundingBox();
    await page.mouse.move(square.x + 15, square.y + 15);
    await page.mouse.down();
    await page.mouse.move(square.x + 85, square.y + 75, { steps: 8 });
    await page.mouse.up();
    const afterSV = await page.evaluate(() => settings.customColor);
    assert.notEqual(afterSV, continuous.at(-1).seed);
    await page.getByRole('slider', { name: '色相', exact: true }).focus();
    const hueBeforeKey = await page.getByRole('slider', { name: '色相', exact: true }).getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.notEqual(await page.getByRole('slider', { name: '色相', exact: true }).getAttribute('aria-valuenow'), hueBeforeKey);
    report.checks.push('Embedded hue and SV controls support continuous pointer dragging with actual MCU palette changes, pointer capture and keyboard adjustment; no native color input exists.');
    await page.getByRole('textbox', { name: '基础颜色十六进制值' }).fill('#4bf11e');
    await page.getByRole('button', { name: '壁纸取色', exact: true }).click();
    assert(await page.locator('[data-liuli-color-custom]').isHidden());
    assert.equal(await page.locator('.liuli-palette-role').count(), 8);
    assert.equal(await page.getByRole('button', { name: '壁纸取色', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '自定义颜色', exact: true }).click();
    assert(await page.locator('[data-liuli-color-custom]').isVisible());
    assert.equal(await page.getByRole('textbox', { name: '基础颜色十六进制值' }).inputValue(), '#4bf11e');
    report.checks.push('Wallpaper/custom switching keeps the saved custom seed and keeps derived role previews visible.');
    await page.evaluate(() => setTheme(false));
    await page.screenshot({ path: path.join(out, 'custom-light.png'), fullPage: true });
    await page.evaluate(() => setTheme(true));
    await page.setViewportSize({ width: 390, height: 1500 });
    report.narrow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth, cards: [...document.querySelectorAll('.liuli-palette-role')].map(x => x.getBoundingClientRect().toJSON()) }));
    assert(report.narrow.scroll <= report.narrow.viewport);
    assert.equal(report.narrow.cards[0].y, report.narrow.cards[1].y);
    assert(report.narrow.cards[2].y > report.narrow.cards[0].y);
    await page.screenshot({ path: path.join(out, 'custom-narrow.png'), fullPage: true });
    report.checks.push('Light/dark roles and narrow two-column layout render without horizontal overflow.');
    await page.evaluate(() => addSecondPanel());
    await page.getByRole('textbox', { name: '基础颜色十六进制值' }).first().fill('#9865ef');
    const cards = await page.evaluate(() => [...document.querySelectorAll('.liuli-palette-card')].map(card => ({source:card.querySelector('.liuli-palette-heading__source').textContent,values:[...card.querySelectorAll('code')].map(x=>x.textContent)})));
    assert.equal(cards.length, 2);
    assert.deepEqual(cards[0], cards[1]);
    assert(cards[0].source.includes('#9865EF'));
    report.checks.push('Two connected settings panels refresh source and all role HEX text together after an edit.');
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ out, passed: report.passed, error: report.error }));
  }
})();
