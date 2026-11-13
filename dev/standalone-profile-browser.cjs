'use strict';
// Local Chromium + about:blank iframe regression. Does not connect to QQ.
// node dev/standalone-profile-browser.cjs <playwright module path> [chromium exe]
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const { testing } = require('../standalone-profile.cjs');
const base = {
  '--ll-brand': '#683a92', '--ll-brand-rgb': '104, 58, 146', '--ll-brand-hover': '#7950a0',
  '--ll-brand-pressed': '#563080', '--ll-on-brand': '#ffffff', '--ll-on-glass': '#221b26',
  '--ll-on-glass-rgb': '34, 27, 38', '--ll-on-glass-2': '#51465a', '--ll-on-glass-3': '#675a70',
  '--ll-popup-bg': '#eee0f7', '--ll-acrylic': '233, 220, 241',
  '--ll-material-opacity': '.72', '--ll-material-blur': 'blur(12px) saturate(1.6)', '--ll-stroke-2': '#ab99ba'
};
const config = { token: 'local-profile:', variables: testing.VARIABLES, css: testing.PROFILE_CSS };
const sourceFn = testing.watchSource.toString();
const profileFn = testing.watchProfile.toString();
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<iframe id="card" src="about:blank"></iframe><iframe id="shell" src="about:blank"></iframe><iframe id="source" src="about:blank"></iframe>');
    const card = page.frames().find(frame => frame.name() === 'card') || page.frames()[1];
    const shell = page.frames()[2];
    const source = page.frames()[3];
    const inject = frame => frame.evaluate(`(${profileFn})(${JSON.stringify(config)})`);
    assert.equal(await inject(card), false);
    assert.equal(await inject(shell), false);
    await shell.evaluate(() => { document.body.innerHTML = '<div class="av-call"><button class="q-button--primary">通话</button></div>'; });
    assert.equal(await shell.locator('#liuli-standalone-profile-style').count(), 0);
    await card.evaluate(() => {
      document.head.innerHTML = '<style>.q-button--primary { background: rgb(0, 153, 255); color: white; } .buddy-profile { background: white; }</style>';
      document.body.innerHTML = '<div id="outside"><button class="q-button--primary">外部</button></div><div class="standalone-mini-profile-container"><div class="contact-mini-profile"><div class="buddy-profile"><button id="action" class="q-button--primary"><span>发消息</span></button></div></div></div>';
      document.querySelector('.standalone-mini-profile-container').style.setProperty('--ll-brand', '#112233', 'important');
    });
    await card.waitForFunction(() => !!window.__snowloraLiuliProfile?.scan());
    assert.equal(await card.locator('#liuli-standalone-profile-style').count(), 0);
    const initialController = await card.evaluate(() => { window.savedController = window.__snowloraLiuliProfile; return true; });
    assert(initialController);
    await inject(card);
    assert(await card.evaluate(() => window.savedController === window.__snowloraLiuliProfile));
    await card.evaluate(vars => window.__snowloraLiuliProfile.update(vars), base);
    const css = await card.evaluate(() => ({
      button: getComputedStyle(document.querySelector('#action')).backgroundColor,
      text: getComputedStyle(document.querySelector('#action span')).color,
      outside: getComputedStyle(document.querySelector('#outside button')).backgroundColor,
      backdrop: getComputedStyle(document.querySelector('.contact-mini-profile')).backdropFilter,
      root: document.body.style.cssText,
      fullTheme: !!window.LiuliHost || !!window.SnowLoraLiuli || !!document.querySelector('#liuli-dsh-theme, #liuli-wallpaper-style')
    }));
    assert.equal(css.button, 'rgb(104, 58, 146)');
    assert.equal(css.text, 'rgb(255, 255, 255)');
    assert.equal(css.outside, 'rgb(0, 153, 255)');
    assert.equal(css.backdrop, 'blur(12px) saturate(1.6)');
    assert.equal(css.root, '');
    assert.equal(css.fullTheme, false);
    assert.equal(await card.locator('#liuli-standalone-profile-style').count(), 1);
    // Real MutationObserver/source -> serialized whitelist -> card update.
    const messages = [];
    page.on('console', entry => { if (entry.text().startsWith('local-source:')) messages.push(JSON.parse(entry.text().slice('local-source:'.length))); });
    await source.evaluate(vars => { location.hash = '/main'; for (const [name, value] of Object.entries(vars)) document.body.style.setProperty(name, value); document.body.style.setProperty('--ll-wallpaper', 'url(SECRET)'); }, base);
    await source.evaluate(`(${sourceFn})(${JSON.stringify({ token: 'local-source:', variables: testing.VARIABLES })})`);
    await page.waitForFunction(() => true);
    await source.evaluate(() => { document.body.style.setProperty('--ll-brand', '#00aa77'); document.body.style.setProperty('--ll-brand-rgb', '0, 170, 119'); document.body.style.setProperty('--ll-on-brand', '#001a10'); });
    await source.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--ll-brand') === '#00aa77');
    // Wait for the 40ms mutation debounce, via observable console delivery.
    await new Promise((resolve, reject) => {
      if (messages.some(item => item.vars['--ll-brand'] === '#00aa77')) return resolve();
      const timeout = setTimeout(() => reject(new Error('source palette change not delivered')), 3000);
      page.on('console', function listener(entry) {
        if (!entry.text().startsWith('local-source:') || !entry.text().includes('#00aa77')) return;
        clearTimeout(timeout); page.off('console', listener); resolve();
      });
    });
    const next = testing.sanitizePalette(messages.findLast(item => item.vars['--ll-brand'] === '#00aa77').vars);
    assert(next);
    assert(!JSON.stringify(next).includes('SECRET'));
    await card.evaluate(vars => window.__snowloraLiuliProfile.update(vars), next);
    assert.equal(await card.locator('#action').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 170, 119)');
    assert.equal(await card.locator('#action span').evaluate(el => getComputedStyle(el).color), 'rgb(0, 26, 16)');
    // Source controller is also idempotent; reentering main resends same palette.
    await source.evaluate(() => { window.oldSource = window.__snowloraLiuliProfileSource; });
    await source.evaluate(`(${sourceFn})(${JSON.stringify({ token: 'local-source:', variables: testing.VARIABLES })})`);
    assert(await source.evaluate(() => window.oldSource === window.__snowloraLiuliProfileSource));
    // Class-only completion of a pooled card is detected, then removal cleans style.
    await shell.evaluate(vars => window.__snowloraLiuliProfile.update(vars), next);
    await shell.evaluate(() => { document.body.innerHTML = '<div id="late"><div class="contact-mini-profile"><div class="buddy-profile"><button class="q-button--primary">动作</button></div></div></div>'; });
    assert.equal(await shell.locator('#liuli-standalone-profile-style').count(), 0);
    await shell.evaluate(() => { document.querySelector('#late').className = 'standalone-mini-profile-container'; });
    await shell.waitForFunction(() => !!document.querySelector('#liuli-standalone-profile-style'));
    await shell.evaluate(() => { document.querySelector('#late').remove(); });
    await shell.waitForFunction(() => !document.querySelector('#liuli-standalone-profile-style'));
    // Restore previous inline properties when a recognized card loses its chain.
    await card.evaluate(() => { document.querySelector('.buddy-profile').className = 'av-call'; });
    await card.waitForFunction(() => !document.querySelector('#liuli-standalone-profile-style'));
    assert.equal(await card.locator('.standalone-mini-profile-container').evaluate(el => el.style.getPropertyValue('--ll-brand')), '#112233');
    assert.equal(await card.locator('.standalone-mini-profile-container').evaluate(el => el.style.getPropertyPriority('--ll-brand')), 'important');
    assert.equal(await card.locator('[data-liuli-standalone-profile]').count(), 0);
    console.log('PASS Chromium about:blank iframe: pooled late DOM, scoped buttons/material, live palette, no wallpaper/full theme, idempotence, cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
