'use strict';
// Production public vnode traversal + real layout controls in isolated Edge.
// The native menu uses existing config/action objects and spies its settingStore.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/responsive-motion-20261113/shortcuts-regression'));
fs.mkdirSync(output, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = '<!doctype html><style>.sidebar__menu{display:flex;gap:8px}.icon-item,.more-h-menu-item{padding:8px}.more-h-menu-pin{display:inline-block;width:24px;height:24px}.more-h-menu-pin svg{width:16px;height:16px}.more-menu{border:1px solid #aaa;max-width:200px}.liuli-mode-row{margin:10px}</style><body data-liuli-scope="main"><div id="app"></div><div id="controls"></div></body>';
const fixture = () => {
  window.nativeStoreWrites = [];
  window.nativeActions = [];
  window.nativePinCalls = [];
  window.generations = [];
  window.settingStore = { setMenuConfig(value) { window.nativeStoreWrites.push(value); } };
  const allMenuConfig = Object.fromEntries([
    ['favorites', '收藏'], ['mail', '邮箱'], ['qzone', '空间'], ['more', '更多']
  ].map(([id, label]) => [id, { id, label, action(event) { window.nativeActions.push({ id, trusted: event.isTrusted }); } }]));
  function mount() {
    const previous = window.nativeMenu;
    if (previous) {
      previous.component.isUnmounted = true;
      previous.node.remove();
      previous.popup.remove();
    }
    const node = document.createElement('div');
    node.className = 'container-sidebar';
    const popup = document.createElement('div');
    popup.className = 'more-menu';
    document.querySelector('#app').append(node, popup);
    const items = [allMenuConfig.favorites, allMenuConfig.more];
    const hMenuItems = [allMenuConfig.mail, allMenuConfig.qzone];
    const state = { node, popup, originalItems: [...items], originalHidden: [...hMenuItems], arrays: [items], hiddenArrays: [hMenuItems], renders: 0 };
    const component = {
      vnode: { el: node }, setupState: { allMenuConfig },
      ctx: {
        items, hMenuItems,
        getSideBarMenuItems() { return ['favorites', 'mail', 'qzone']; },
        switchHMenuItem(item) { window.settingStore.setMenuConfig(item.id); },
      },
      proxy: { $forceUpdate: render },
      isUnmounted: false
    };
    state.component = component;
    function render() {
      state.renders++;
      node.replaceChildren();
      const sidebar = document.createElement('div');
      sidebar.className = 'sidebar__menu';
      for (const config of component.ctx.items) {
        const item = document.createElement('div');
        item.className = config.id === 'more' ? 'func-menu-more-component' : 'native-shortcut';
        item.dataset.id = config.id;
        const action = document.createElement('button');
        action.className = 'icon-item';
        action.textContent = config.label;
        action.addEventListener('click', config.action);
        item.append(action); sidebar.append(item);
      }
      node.append(sidebar);
      // Keyed native Vue children can retain their DOM and static attributes.
      // A forceUpdate must not be assumed to undo attributes added by a plugin.
      for (const row of popup.children) if (!component.ctx.hMenuItems.some(item => item.id === row.dataset.id)) row.remove();
      for (const config of component.ctx.hMenuItems) {
        const existing = [...popup.children].find(row => row.dataset.id === config.id);
        if (existing) { popup.append(existing); continue; }
        const row = document.createElement('div');
        row.className = 'more-h-menu-item'; row.dataset.id = config.id;
        const label = document.createElement('span');
        label.className = 'func-menu-label'; label.textContent = config.label;
        label.addEventListener('click', config.action);
        const pin = document.createElement('button');
        pin.className = 'more-h-menu-pin';
        pin.setAttribute('aria-label', '原生固定' + config.label);
        pin.innerHTML = '<svg><use xlink:href="native-unpinned"></use></svg>';
        pin.addEventListener('click', event => {
          window.nativePinCalls.push(config.id);
          component.ctx.switchHMenuItem(config, event);
        });
        row.append(label, pin); popup.append(row);
      }
    }
    document.querySelector('#app')._vnode = { component };
    window.nativeMenu = state;
    window.generations.push(state);
    render();
    return state;
  }
  window.mountNativeMenu = mount;
  window.replaceNativeArrays = () => {
    const state = window.nativeMenu;
    state.component.ctx.items = [...state.originalItems];
    state.component.ctx.hMenuItems = [...state.originalHidden];
    state.arrays.push(state.component.ctx.items);
    state.hiddenArrays.push(state.component.ctx.hMenuItems);
    state.component.proxy.$forceUpdate();
  };
  window.inspectShortcuts = () => ({
    enabled: document.body.hasAttribute('data-liuli-shortcuts-unlocked'),
    items: window.nativeMenu.component.ctx.items.map(item => item.id),
    hidden: window.nativeMenu.component.ctx.hMenuItems.map(item => item.id),
    pinStates: [...document.querySelectorAll('.more-h-menu-item')].map(row => {
      const pin = row.querySelector('.more-h-menu-pin');
      return { id: row.dataset.id, label: pin.getAttribute('aria-label'), pressed: pin.getAttribute('aria-pressed'), role: pin.getAttribute('role'), href: pin.querySelector('use')?.getAttribute('xlink:href') };
    }),
    storeWrites: window.nativeStoreWrites,
    nativePinCalls: window.nativePinCalls,
    actions: window.nativeActions,
    productionOnly: !document.querySelector('.icon-item').__VUE__,
    generations: window.generations.map(state => ({ unmounted: state.component.isUnmounted,
      items: state.arrays.map(array => array.map(item => item.id)), hidden: state.hiddenArrays.map(array => array.map(item => item.id)) }))
  });
  mount();
};
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'QQ production vnode-shaped component fixture; real native button events and two same-origin windows; no live QQ/store writes', cases: [], failures: [] };
  try {
    const context = await browser.newContext();
    await context.route('http://liuli-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    const errors = [];
    const pages = [];
    for (const name of ['main', 'settings']) {
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://liuli-fixture.test/' + name);
      await page.evaluate(fixture);
      await page.addScriptTag({ content: read('renderer/qq.js') });
      await page.addScriptTag({ content: read('renderer/layout-custom.js') });
      await page.evaluate(() => { window.LiuliLayout.installLayout(); window.LiuliLayout.buildLayoutControls(document.querySelector('#controls')); });
      pages.push(page);
    }
    const [main, settings] = pages;
    const inspect = page => page.evaluate(() => window.inspectShortcuts());
    const waitItems = (page, ids) => page.waitForFunction(ids => JSON.stringify(window.nativeMenu.component.ctx.items.map(item => item.id)) === JSON.stringify(ids), ids);
    const toggle = settings.locator('.liuli-mode-row').filter({ hasText: '解除底部快捷入口数量限制' });
    const initial = await inspect(main);
    assert.equal(initial.enabled, false); assert.deepEqual(initial.items, ['favorites', 'more']); assert(initial.productionOnly);
    report.cases.push({ name: 'native-default', passed: true, state: initial });
    await toggle.getByRole('button', { name: '开启', exact: true }).click();
    await main.waitForFunction(() => document.body.hasAttribute('data-liuli-shortcuts-unlocked'));
    for (const page of pages) assert.deepEqual((await inspect(page)).hidden, ['favorites', 'mail', 'qzone']);
    report.cases.push({ name: 'real-setting-toggle-and-storage', passed: true, states: await Promise.all(pages.map(inspect)) });
    await main.locator('[data-id=mail] .more-h-menu-pin').click();
    await main.locator('[data-id=qzone] .more-h-menu-pin').click();
    for (const page of pages) await waitItems(page, ['favorites', 'mail', 'qzone', 'more']);
    const expanded = await inspect(main);
    assert.deepEqual(expanded.storeWrites, []); assert.deepEqual(expanded.nativePinCalls, []);
    assert.equal(expanded.pinStates.find(pin => pin.id === 'mail').pressed, 'true');
    report.cases.push({ name: 'native-pin-more-than-two-entries', passed: true, state: expanded });
    await main.locator('[data-id=mail] .func-menu-label').click();
    await main.locator('.native-shortcut[data-id=qzone] .icon-item').click();
    const actions = await inspect(main);
    assert.deepEqual(actions.actions, [{ id: 'mail', trusted: true }, { id: 'qzone', trusted: true }]);
    assert.deepEqual(actions.storeWrites, []);
    report.cases.push({ name: 'ordinary-native-menu-actions', passed: true, state: actions });
    await main.locator('[data-id=mail] .more-h-menu-pin').click();
    for (const page of pages) await waitItems(page, ['favorites', 'qzone', 'more']);
    assert.equal((await inspect(main)).pinStates.find(pin => pin.id === 'mail').pressed, 'false');
    report.cases.push({ name: 'same-native-pin-removes-selection', passed: true, states: await Promise.all(pages.map(inspect)) });
    await main.evaluate(() => window.replaceNativeArrays());
    await waitItems(main, ['favorites', 'qzone', 'more']);
    report.cases.push({ name: 'native-array-replacement', passed: true, state: await inspect(main) });
    await main.evaluate(() => window.mountNativeMenu());
    await waitItems(main, ['favorites', 'qzone', 'more']);
    const rebuilt = await inspect(main);
    report.cases.push({ name: 'native-root-rebuild', state: rebuilt });
    try {
      assert.deepEqual(rebuilt.generations[0].items, [['favorites', 'more'], ['favorites', 'more']], 'Detached native component arrays were retained in the expanded state');
      report.cases.at(-1).passed = true;
    } catch (error) { report.cases.at(-1).passed = false; report.failures.push(error.message); }
    await toggle.getByRole('button', { name: '关闭', exact: true }).click();
    for (const page of pages) {
      await page.waitForFunction(() => !document.body.hasAttribute('data-liuli-shortcuts-unlocked'));
      const state = await inspect(page);
      assert.deepEqual(state.items, ['favorites', 'more']); assert.deepEqual(state.hidden, ['mail', 'qzone']);
      for (const generation of state.generations) {
        for (const array of generation.items) assert.deepEqual(array, ['favorites', 'more']);
        for (const array of generation.hidden) assert.deepEqual(array, ['mail', 'qzone']);
      }
      assert.deepEqual(state.storeWrites, []); assert.deepEqual(state.nativePinCalls, []);
      try {
        for (const pin of state.pinStates) {
          assert.equal(pin.pressed, null, 'Disabled native menu retained plugin aria-pressed');
          assert.equal(pin.role, null, 'Disabled native menu retained plugin explicit role');
          assert.equal(pin.href, 'native-unpinned', 'Disabled native pin retained plugin icon');
          assert.equal(pin.label, '原生固定' + ({ mail: '邮箱', qzone: '空间' })[pin.id], 'Disabled native pin retained plugin action label');
        }
      } catch (error) { report.failures.push(error.message); }
    }
    report.cases.push({ name: 'disable-restores-native-items-without-store-write', passed: true, states: await Promise.all(pages.map(inspect)) });
    await toggle.getByRole('button', { name: '开启', exact: true }).click();
    await waitItems(main, ['favorites', 'qzone', 'more']);
    await main.addScriptTag({ content: read('renderer/qq.js') });
    await waitItems(main, ['favorites', 'qzone', 'more']);
    await main.evaluate(() => window.__liuliSidebarShortcuts.dispose());
    assert.deepEqual((await inspect(main)).items, ['favorites', 'more']);
    report.cases.push({ name: 'reinjection-disposal', passed: true, state: await inspect(main) });
    assert.deepEqual(errors, []);
    assert.deepEqual(report.failures, [], 'Native component lifecycle cleanup failed');
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, error: report.error })); }
})();
