'use strict';
// Production message controller + pane controller in isolated Chromium. Live QQ
// first-visit evidence is separate; this fixture never stands in for that evidence.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('renderer/index.js');
const controller = `(() => {
  const motion = window.LiuliMotion;
  const LL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const LL_ENTER_MAX = 14;
  ${index.slice(index.indexOf('  function llMessagePeerKey('), index.indexOf('  function llMsgId('))}
  ${index.slice(index.indexOf('  function llVisibleIn('), index.indexOf('  var llSel ='))}
  ${index.slice(index.indexOf('  function llAnimateEnter('), index.indexOf('  /* 群成员行插入'))}
  let llSwitchInstalled = false;
  ${index.slice(index.indexOf('  function installSwitchMotion('), index.indexOf('  function installPageObserver('))}
  installSwitchMotion();
})();`;
const scripts = ['renderer/qq.js', 'renderer/motion.js', 'renderer/switch-motion-guard.js', 'renderer/side-pane-motion.js']
  .map(name => name === 'renderer/side-pane-motion.js' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read(name));
const output = path.resolve(process.argv[4] || path.resolve(root, '../../output/playwright/cold-switch-repair-20261113'));
fs.mkdirSync(output, { recursive: true });
async function inspectSameGroupReopen(page, name) {
  const samples = [];
  const check = async stage => {
    const sample = await page.evaluate(stage => {
      const pane = document.querySelector('.group-box__container');
      return { stage, running: window.__liuliSidePaneMotion.running,
        motionFlags: document.querySelectorAll('[data-liuli-side-motion], [data-liuli-side-wait], [data-liuli-pane-retained], [data-liuli-input-motion]').length,
        overlays: document.querySelectorAll('.liuli-pane-transition').length,
        width: pane.getBoundingClientRect().width, visibility: getComputedStyle(pane).visibility,
        transform: getComputedStyle(pane).transform,
        paneAnimations: pane.getAnimations().length };
    }, stage);
    samples.push(sample);
    assert.equal(sample.running, false, 'Same-group reopening started a conversation side transition: ' + JSON.stringify(sample));
    assert.equal(sample.motionFlags, 0, 'Same-group collapse/reopen retained a side-transition mask: ' + JSON.stringify(sample));
    assert.equal(sample.overlays, 0);
    if (stage !== 'collapsed-during-enter') {
      assert.equal(sample.width, 180);
      assert.equal(sample.visibility, 'visible', 'Reopened group pane stayed hidden before the 4-second fallback');
      assert.equal(sample.transform, 'none');
      assert.equal(sample.paneAnimations, 0, 'Reopening a collapsed chat invented a horizontal pane movement');
    }
  };
  if (name === 'same-group-detached-geometry') {
    // A retained aio may also be removed/reinserted by native routing. A head
    // mutation runs style measurement while the old pane has no aio ancestor.
    await page.evaluate(() => {
      window.detachedAio = document.querySelector('.aio');
      const pane = document.querySelector('.group-box__container');
      pane.remove();
      window.detachedAio.remove();
      document.querySelector('style').textContent += '.group-notice{letter-spacing:0px}';
      window.detachedPane = pane;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => {
      window.detachedAio.querySelector('.group-panel').appendChild(window.detachedPane);
      document.querySelector('#app').appendChild(window.detachedAio);
      delete window.detachedAio;
      delete window.detachedPane;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await check('reattached');
  }
  if (name === 'same-group-collapse-during-enter') {
    await page.evaluate(() => { window.send('g1'); window.route('g1'); });
    assert(await page.evaluate(() => window.__liuliSidePaneMotion.running && document.querySelector('.aio').hasAttribute('data-liuli-side-wait')),
      'The setup did not create a pending private-to-group entrance');
    // The selected item closes the chat instead of changing its destination.
    // It must cancel the pending entrance before QQ hides the existing aio.
    await page.evaluate(() => { window.send('g1'); window.collapse('g1'); });
    await check('collapsed-during-enter');
  } else {
    await page.evaluate(() => { window.send('g1'); window.collapse('g1'); });
  }
  if (name !== 'same-group-rapid-reopen') {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.group-chat').evaluate(element => element.getBoundingClientRect().width), 0,
      'The closed-chat setup did not invalidate the previous visible geometry');
  }
  await page.evaluate(() => { window.send('g1'); window.reopen('g1'); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await check('reopened-before-fallback');
  if (name === 'same-group-rapid-reopen') {
    // No rendering opportunity between native collapse and reopen: cached
    // geometry still belongs to the visible group, while aio.style says hidden.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.send('g1'); window.collapse('g1'); window.send('g1'); window.reopen('g1'); });
      await check('rapid-reopen-' + (i + 1));
    }
  }
  await page.waitForTimeout(400);
  await check('settled-before-fallback');
  return samples;
}
async function inspectBoundary(page, direction, id, report) {
  const baseline = await page.evaluate(direction => {
    const input = document.querySelector('.chat-input-area');
    const pane = document.querySelector('.group-box__container');
    const rootRect = input.getBoundingClientRect();
    const overlay = document.querySelector('.liuli-pane-transition');
    const moving = overlay?.shadowRoot.children[1];
    const slide = (overlay?.shadowRoot.getAnimations() || pane.getAnimations()).find(animation => animation.id === 'liuli-side-pane-motion');
    const surface = input.getAnimations({ subtree: true }).find(animation => animation.id === 'liuli-side-input-surface');
    const controls = document.querySelector('.send-msg');
    const material = getComputedStyle(input, '::before');
    const materialRight = rootRect.left + parseFloat(material.width) * new DOMMatrixReadOnly(material.transform).m11;
    const paneLeft = direction === 'exit' ? moving.getBoundingClientRect().left : pane.getBoundingClientRect().left;
    window.boundaryAnimations = [slide, surface, ...controls.getAnimations()];
    window.__liuliSidePaneMotion.messageReady();
    for (const animation of window.boundaryAnimations) { animation.pause(); animation.currentTime = 0; }
    return { gap: paneLeft - materialRight, rootWidth: rootRect.width,
      editorWidth: document.querySelector('.editor').getBoundingClientRect().width,
      sendInset: materialRight - controls.getBoundingClientRect().right,
      duration: slide.effect.getTiming().duration, paneEasing: slide.effect.getTiming().easing,
      surfaceEasing: surface.effect.getTiming().easing, surfaceTarget: surface.effect.pseudoElement,
      timings: window.boundaryAnimations.map(animation => animation.effect.getTiming()) };
  }, direction);
  assert.equal(baseline.paneEasing, baseline.surfaceEasing, 'Pane and input surface must share one easing curve');
  assert.equal(baseline.surfaceTarget, '::before', 'Only the glass pseudo-element may scale');
  assert(baseline.duration > 100 && baseline.duration <= 200,
    'The side transition must settle within 200ms without becoming an instant jump');
  assert(baseline.timings.every(timing => timing.duration === baseline.duration && timing.easing === baseline.paneEasing),
    'Pane, glass and send controls must retain the same duration and easing');
  const curve = await page.evaluate(({ duration, direction }) => {
    const samples = [];
    const input = document.querySelector('.chat-input-area');
    const pane = document.querySelector('.group-box__container');
    const moving = document.querySelector('.liuli-pane-transition')?.shadowRoot.children[1];
    for (let step = 0; step <= 20; step++) {
      const fraction = step / 20;
      for (const animation of window.boundaryAnimations) animation.currentTime = fraction * duration;
      const rect = input.getBoundingClientRect();
      const material = getComputedStyle(input, '::before');
      samples.push({ fraction, elapsed: fraction * duration,
        paneLeft: direction === 'exit' ? moving.getBoundingClientRect().left : pane.getBoundingClientRect().left,
        materialRight: rect.left + parseFloat(material.width) * new DOMMatrixReadOnly(material.transform).m11,
        sendRight: document.querySelector('.send-msg').getBoundingClientRect().right });
    }
    for (const animation of window.boundaryAnimations) animation.currentTime = 0;
    const first = samples[0], last = samples.at(-1);
    return samples.map(sample => ({ ...sample,
      progress: (sample.paneLeft - first.paneLeft) / (last.paneLeft - first.paneLeft),
      surfaceProgress: (sample.materialRight - first.materialRight) / (last.materialRight - first.materialRight),
      controlProgress: (sample.sendRight - first.sendRight) / (last.sendRight - first.sendRight) }));
  }, { duration: baseline.duration, direction });
  for (let i = 0; i < curve.length; i++) {
    const sample = curve[i];
    assert(sample.progress >= -0.001 && sample.progress <= 1.001,
      'The shared edge overshot its destination: ' + JSON.stringify(sample));
    if (i) assert(sample.progress >= curve[i - 1].progress - 0.001,
      'The shared edge reversed during the transition: ' + JSON.stringify(sample));
    assert(Math.abs(sample.paneLeft - sample.materialRight - baseline.gap) < 0.1 &&
      Math.abs(sample.materialRight - sample.sendRight - baseline.sendInset) < 0.1,
      'The nonlinear curve separated pane, material or controls: ' + JSON.stringify(sample));
  }
  const early = curve.find(sample => sample.fraction === 0.25);
  const half = curve.find(sample => sample.fraction === 0.5);
  assert(early.progress >= 0.55 && early.progress <= 0.9,
    'The first quarter must show a clear, quick response with visible travel remaining: ' + JSON.stringify(early));
  assert(half.progress >= 0.85 && half.progress < 1,
    'Most travel should finish in the first half, leaving a short settling tail: ' + JSON.stringify(half));
  report.curveSamples.push({ direction, id, duration: baseline.duration, samples: curve });
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const sample = await page.evaluate(({ fraction, duration, direction }) => {
      for (const animation of window.boundaryAnimations) animation.currentTime = fraction * duration;
      const input = document.querySelector('.chat-input-area');
      const rect = input.getBoundingClientRect();
      const material = getComputedStyle(input, '::before');
      const materialScale = new DOMMatrixReadOnly(material.transform).m11;
      const moving = document.querySelector('.liuli-pane-transition')?.shadowRoot.children[1];
      const pane = document.querySelector('.group-box__container');
      return { fraction, rootWidth: rect.width, editorWidth: document.querySelector('.editor').getBoundingClientRect().width,
        materialWidth: parseFloat(material.width) * materialScale,
        materialNaturalWidth: parseFloat(material.width), materialScale,
        materialRight: rect.left + parseFloat(material.width) * materialScale,
        paneLeft: direction === 'exit' ? moving.getBoundingClientRect().left : pane.getBoundingClientRect().left,
        sendRight: document.querySelector('.send-msg').getBoundingClientRect().right,
        inputClip: getComputedStyle(input).clipPath, columnClip: getComputedStyle(input.parentElement).clipPath,
        blur: material.backdropFilter, materialShadow: material.boxShadow, rootShadow: getComputedStyle(input).boxShadow,
        rootTransform: getComputedStyle(input).transform,
        editorTransform: getComputedStyle(document.querySelector('.editor')).transform,
        controlTransform: getComputedStyle(document.querySelector('.send-msg')).transform,
        inputMotion: input.hasAttribute('data-liuli-input-motion'), running: window.__liuliSidePaneMotion.running };
    }, { fraction, duration: baseline.duration, direction });
    assert(Math.abs(sample.paneLeft - sample.materialRight - baseline.gap) < 0.1,
      'Shared pane/input boundary separated: ' + JSON.stringify({ baseline, sample }));
    assert(Math.abs(sample.materialRight - sample.sendRight - baseline.sendInset) < 0.1,
      'Send control separated from the material edge: ' + JSON.stringify({ baseline, sample }));
    assert.equal(sample.rootWidth, baseline.rootWidth, 'Input root reflowed during the surface animation');
    assert.equal(sample.editorWidth, baseline.editorWidth, 'Editor reflowed during the surface animation');
    assert(Math.abs(sample.materialNaturalWidth - baseline.rootWidth) < 0.1, 'Input material layout width changed during scaling');
    assert.equal(sample.rootTransform, 'none', 'Input root was scaled with the glass');
    assert.equal(sample.editorTransform, 'none', 'Editor was scaled with the glass');
    assert.equal(sample.controlTransform, 'none', 'Send control was scaled with the glass');
    assert.equal(sample.inputClip, 'none');
    assert.equal(sample.columnClip, 'none');
    assert.notEqual(sample.blur, 'none', 'Input material lost wallpaper blur');
    assert.equal(sample.rootShadow, 'none', 'The final-width root leaked a second shadow: ' + JSON.stringify(sample));
    assert.notEqual(sample.materialShadow, 'none', 'The moving material lost its shadow');
    const screenshot = 'boundary-' + direction + '-' + id + '-' + Math.round(fraction * 100) + '.png';
    await page.locator('.aio:not([data-ll-pane-ancestor])').screenshot({ path: path.join(output, screenshot) });
    report.boundarySamples.push({ direction, id, screenshot, baseline, ...sample });
  }
  await page.evaluate(() => {
    for (const animation of window.boundaryAnimations) { animation.currentTime = 0; animation.play(); }
    delete window.boundaryAnimations;
  });
}
async function inspectSurfaceCompositing(page) {
  const session = await page.context().newCDPSession(page);
  let layers = [];
  session.on('LayerTree.layerTreeDidChange', event => { if (event.layers) layers = event.layers; });
  try {
    await session.send('DOM.enable');
    await session.send('LayerTree.enable');
    await page.evaluate(() => { window.send('p2'); window.route('p2', false); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const animation = await page.evaluate(() => {
      const input = document.querySelector('.chat-input-area');
      const surface = input.getAnimations({ subtree: true }).find(animation => animation.id === 'liuli-side-input-surface');
      const overlay = document.querySelector('.liuli-pane-transition');
      const slide = overlay.shadowRoot.getAnimations().find(animation => animation.id === 'liuli-side-pane-motion');
      // Extend only this isolated capability probe so CDP can inspect an active
      // effect. Production durations and lifecycle cases stay unchanged.
      const productionDuration = surface.effect.getTiming().duration;
      for (const effect of [surface, slide]) effect.effect.updateTiming({ duration: 5000 });
      window.__liuliSidePaneMotion.messageReady();
      return { pseudoElement: surface.effect.pseudoElement, frames: surface.effect.getKeyframes(),
        productionDuration, capabilityProbeDuration: surface.effect.getTiming().duration };
    });
    await page.waitForTimeout(100);
    const { root: documentNode } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '.chat-input-area' });
    const { node } = await session.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const pseudo = node.pseudoElements?.find(element => element.pseudoType === 'before');
    assert(pseudo, 'The material ::before was not exposed to the Edge DOM protocol');
    const surfaceLayers = layers.filter(layer => layer.backendNodeId === pseudo.backendNodeId);
    const reasons = [];
    for (const layer of surfaceLayers) reasons.push({ layerId: layer.layerId, backendNodeId: layer.backendNodeId,
      ...(await session.send('LayerTree.compositingReasons', { layerId: layer.layerId })) });
    const accelerated = reasons.some(result => result.compositingReasonIds?.includes('ActiveTransformAnimation'));
    const evidence = { scope: 'Isolated Edge capability evidence; does not measure QQ compositor state or FPS',
      animation, pseudoBackendNodeId: pseudo.backendNodeId, surfaceLayers, reasons, accelerated };
    fs.writeFileSync(path.join(output, 'surface-compositing-evidence.json'), JSON.stringify(evidence, null, 2));
    assert(accelerated, 'The material ::before was not composited for its active transform: ' + JSON.stringify(evidence));
    return evidence;
  } finally {
    await page.evaluate(() => window.__liuliSidePaneMotion.dispose());
    await session.detach();
  }
}
const fixture = `<!doctype html><style>
body{margin:0;font:14px sans-serif;background:#e9e7ed;--ll-card-shadow:0 2px 10px #0006}.recent-contact-item{height:28px}
#app::before{content:'';position:fixed;inset:0;z-index:-1;background:repeating-linear-gradient(115deg,#707087 0 12px,#e9e7ed 12px 24px)}
.aio{position:relative;width:800px;height:500px;display:flex;flex-direction:column;margin:20px}
.chat-header{height:44px;flex:none}.group-panel{display:flex;flex:1;min-height:0}
.group-chat{flex:1;min-width:auto;display:flex;flex-direction:column}
.chat-msg-area{flex:1;min-height:0;overflow:auto}.ml-item{height:40px;flex:none}.message-container--self{margin-left:auto;width:160px}
.chat-input-area{height:44px;flex:none;position:relative;border-radius:14px;background:transparent;display:flex;isolation:isolate;box-shadow:0 2px 10px #0006}
.chat-input-area::before{content:'';position:absolute;inset:0!important;border-radius:inherit!important;background:#d1ced933;backdrop-filter:blur(12px);z-index:-1}
.editor{padding:8px;flex:1}.send-msg{margin-left:auto;width:36px;height:36px}
.group-box__container{width:180px;flex:none;margin-left:8px}.group-box__container:empty{width:0;margin:0}
.group-box{width:180px;height:100%;border-radius:14px;background:#fff8;backdrop-filter:blur(12px)}
.group-notice{height:60px;padding:10px}.group-member{height:250px;overflow:auto}.group-user{height:24px}
.group-notice::after{content:'Notice';color:#705000}
</style><body data-liuli-scope="main" data-liuli-input-layout="float"><div id="app"><div class="recent-contact">
<div data-contact-id="p1" data-type="1" class="recent-contact-item">Private 1<div class="avatar"></div></div>
<div data-contact-id="g1" data-type="2" class="recent-contact-item">Group 1<div class="avatar"></div></div>
<div data-contact-id="p2" data-type="1" class="recent-contact-item">Private 2<div class="avatar"></div></div>
<div data-contact-id="g2" data-type="2" class="recent-contact-item">Group 2<div class="avatar"></div></div>
</div><div class="aio"><div class="chat-header"><div class="panel-header__title">Original group</div></div>
<div class="group-panel"><div class="group-chat"><div class="chat-msg-area"><div class="ml-item" id="100">Original message</div></div>
<div class="chat-input-area"><div class="editor msg-input" contenteditable="true">Unsent <b>draft</b></div><button class="send-msg">Send</button></div></div>
<div class="group-box__container"><div class="group-box"><div class="group-notice">Original notice</div><div class="group-member">${'<div class="group-user"><span class="group-user__name">Member</span></div>'.repeat(18)}</div></div></div></div></div></div>`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'cold document controller integration and same-group collapse/reopen; no debugger __VUE__ or idle snapshot', cases: [], boundarySamples: [], curveSamples: [] };
  try {
    for (const name of ['same-group-reopen', 'same-group-rapid-reopen', 'same-group-collapse-during-enter', 'same-group-detached-geometry',
      'cold-distinct-conversations', 'cold-group-to-group', 'layout-before-title', 'replace-input-during-wait', 'slow-first-route', 'long-reveal-task', 'legacy-glass-clip', 'stylesheet-change', 'rapid-distinct-switch', 'resize', 'reduced-motion', 'preference-change', 'disposal', 'reinjection', 'drag',
      'reverse-first-route', 'reverse-layout-before-title', 'reverse-replace-pane', 'reverse-replace-input', 'reverse-long-reveal-task', 'reverse-rapid-switch', 'reverse-resize', 'native-boundary', 'reverse-native-boundary']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, reducedMotion: name === 'reduced-motion' ? 'reduce' : 'no-preference' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(fixture);
      if (name.includes('native-boundary')) await page.evaluate(() => {
        document.body.setAttribute('data-liuli-input-layout', 'native');
        document.querySelector('.chat-input-area').style.height = '160px';
      });
      await page.addStyleTag({ content: read('assets/motion.css') + '\n' + read('assets/markdown.css') });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Let theme-load shadow transitions settle before saving appearance.
      await page.waitForTimeout(350);
      await page.evaluate(() => {
        window.originalEditor = document.querySelector('.editor');
        window.originalDraft = window.originalEditor.innerHTML;
        window.nativeInputMin = getComputedStyle(document.querySelector('.chat-input-area')).minWidth;
        window.nativeInputShadow = getComputedStyle(document.querySelector('.chat-input-area')).boxShadow;
        window.nativeMaterialShadow = getComputedStyle(document.querySelector('.chat-input-area'), '::before').boxShadow;
        window.nativeEvents = [];
        window.expectedEvents = [];
        window.visited = [];
        const items = [...document.querySelectorAll('.recent-contact-item')];
        // QQ's native vnode graph, with deliberately no debugger __VUE__ field.
        document.querySelector('#app')._vnode = { children: items.map(item => ({ component: {
          props: { uid: item.dataset.contactId, type: Number(item.dataset.type) },
          vnode: { el: item.querySelector('.avatar') }
        } })) };
        for (const item of items) for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) item.addEventListener(type, event => {
          window.nativeEvents.push({ type, same: window.expectedEvents.includes(event), id: item.dataset.contactId });
        });
        window.send = id => {
          const item = items.find(item => item.dataset.contactId === id);
          for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
            const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, clientY: item.getBoundingClientRect().top + 18 });
            window.expectedEvents.push(event);
            item.dispatchEvent(event);
          }
        };
        window.route = (id, withMessages = false, deferTitle = false) => {
          const item = items.find(item => item.dataset.contactId === id);
          window.visited.push(id);
          items.forEach(element => element.classList.toggle('recent-contact-item--selected', element === item));
          window.finishTitle = () => { document.querySelector('.panel-header__title').textContent = id; };
          if (!deferTitle) window.finishTitle();
          const area = document.querySelector('.chat-msg-area');
          area.replaceChildren();
          const pane = document.querySelector('.group-box__container');
          if (item.dataset.type === '1') pane.replaceChildren();
          else pane.innerHTML = '<div class="group-box"><div class="group-notice">' + id + ' notice</div><div class="group-member"><div class="group-user"><span class="group-user__name">' + id + ' member</span></div></div></div>';
          if (withMessages) window.messages(id);
        };
        window.messages = id => {
          document.querySelector('.chat-msg-area').innerHTML = '<div class="ml-item" id="' + (1000 + window.visited.length) + '"><div class="message-container--self">' + id + ' message</div></div>';
        };
        window.collapse = id => {
          items.find(item => item.dataset.contactId === id).classList.remove('recent-contact-item--selected');
          document.querySelector('.aio').style.display = 'none';
          document.querySelector('.chat-msg-area').replaceChildren();
          const pane = document.querySelector('.group-box__container');
          pane.style.width = '0px';
          pane.replaceChildren();
        };
        window.reopen = id => {
          document.querySelector('.aio').style.removeProperty('display');
          document.querySelector('.group-box__container').style.removeProperty('width');
          window.route(id, true);
        };
      });
      if (name.startsWith('reverse-')) await page.evaluate(() => { window.route('p1', true); window.visited = []; });
      if (name.startsWith('same-group-')) await page.evaluate(name => {
        window.route(name === 'same-group-collapse-during-enter' ? 'p1' : 'g1', true);
        window.visited = [];
      }, name);
      for (const script of scripts) await page.addScriptTag({ content: script });
      await page.addScriptTag({ content: controller });
      if (name === 'stylesheet-change') await page.evaluate(() => {
        document.querySelector('style').textContent += '.group-notice{color:rgb(22,33,44)}';
      });
      if (name.endsWith('long-reveal-task')) await page.evaluate(() => {
        const ready = window.__liuliSidePaneMotion.messageReady;
        window.__liuliSidePaneMotion.messageReady = () => {
          ready();
          const start = performance.now();
          while (performance.now() - start < 380) { /* Cold synchronous QQ work after animation creation. */ }
          requestAnimationFrame(() => {
            const overlay = document.querySelector('.liuli-pane-transition');
            const slide = overlay?.shadowRoot.getAnimations()[0] || document.querySelector('.group-box__container').getAnimations().find(animation => animation.id === 'liuli-side-pane-motion');
            const entry = document.querySelector('.chat-msg-area').getAnimations().find(animation => animation.effect.getTiming().fill === 'backwards');
            window.revealAfterBlock = { panePresent: !!slide, slideTime: slide?.currentTime,
              opacity: getComputedStyle(document.querySelector('.chat-msg-area')).opacity,
              slideStart: slide?.startTime, entryStart: entry?.startTime };
          });
        };
      });
      assert.equal(await page.evaluate(() => window.LiuliQQ.contactType(document.querySelector('[data-contact-id=p1]'))), 1);
      assert.equal(await page.evaluate(() => document.querySelector('.avatar').__VUE__), undefined);
      assert.equal(await page.locator('.liuli-pane-transition').count(), 0);

      if (name.startsWith('same-group-')) {
        const samples = await inspectSameGroupReopen(page, name);
        const result = await page.evaluate(() => ({ events: window.nativeEvents, visited: window.visited,
          editorSame: document.querySelector('.editor') === window.originalEditor && window.originalEditor.innerHTML === window.originalDraft }));
        assert(result.events.every(event => event.same), 'Original same-group native event was replaced or replayed');
        assert(result.editorSame, 'Same-group collapse/reopen changed the draft');
        assert.deepEqual(errors, []);
        report.cases.push({ name, passed: true, visited: result.visited, nativeEvents: result.events.length, samples });
        await page.close();
        continue;
      }

      const destinations = name.startsWith('reverse-') ? ['g1'] : name === 'cold-distinct-conversations' || name === 'reduced-motion' ? ['p1', 'g1', 'p2', 'g2'] :
        name === 'cold-group-to-group' ? ['g1', 'g2'] : ['p1'];
      for (const id of destinations) {
        const oldWidth = await page.locator('.group-chat').evaluate(element => element.getBoundingClientRect().width);
        const wasGroup = await page.locator('.group-box').count() > 0;
        const changingPane = wasGroup !== id.startsWith('g') && name !== 'reduced-motion';
        await page.evaluate(id => window.send(id), id);
        if (wasGroup && id.startsWith('p') && name !== 'reduced-motion') {
          const styles = await page.evaluate(() => {
            const original = document.querySelector('.group-notice');
            const copy = document.querySelector('.liuli-pane-transition').shadowRoot.querySelector('.group-notice');
            const appearance = element => ['color', 'font', 'backgroundColor', 'padding', 'width', 'height'].map(property => getComputedStyle(element)[property]);
            return { original: appearance(original), copy: appearance(copy) };
          });
          assert.deepEqual(styles.copy, styles.original, 'The first snapshot lost native CSS or current theme styles');
        }
        const exit = await page.evaluate(() => document.querySelector('.chat-msg-area').getAnimations().find(animation => animation.effect.getTiming().fill === 'forwards')?.effect.getKeyframes().map(frame => frame.opacity));
        if (name !== 'reduced-motion') assert.deepEqual(exit, ['1', '0'], 'Cold private target disabled the original message exit');
        if (name === 'slow-first-route') await page.waitForTimeout(420);
        if (name === 'rapid-distinct-switch' || name === 'reverse-rapid-switch') {
          await page.evaluate(id => { window.send(id); window.route(id, true); }, name === 'reverse-rapid-switch' ? 'p2' : 'g1');
          await page.waitForTimeout(500);
          assert.equal(await page.locator('.liuli-pane-transition').count(), 0);
          break;
        }
        await page.evaluate(({ id, deferTitle }) => window.route(id, false, deferTitle), { id, deferTitle: name.endsWith('layout-before-title') });
        if (name.endsWith('layout-before-title')) {
          await page.waitForTimeout(140);
          assert.equal(await page.locator('.panel-header__title').textContent(), wasGroup ? 'Original group' : 'p1');
        }
        if (name === 'replace-input-during-wait' || name === 'reverse-replace-input') await page.evaluate(() => {
          const previous = document.querySelector('.chat-input-area');
          previous.replaceWith(previous.cloneNode(true));
          // This replacement belongs to native routing, not the motion module.
          window.originalEditor = document.querySelector('.editor');
        });
        if (name === 'reverse-replace-pane') await page.evaluate(() => {
          const pane = document.querySelector('.group-box__container');
          pane.replaceWith(pane.cloneNode(true));
        });
        if (name !== 'reduced-motion') assert.equal(await page.locator('.chat-msg-area').evaluate(element => getComputedStyle(element).opacity), '0', 'New conversation became visible before its entry');
        if (name === 'cold-group-to-group') assert.equal(await page.locator('.liuli-pane-transition').count(), 0);
        if (changingPane) {
          const held = await page.evaluate(oldWidth => ({
            opacity: getComputedStyle(document.querySelector('.chat-msg-area')).opacity,
            clip: getComputedStyle(document.querySelector('.chat-msg-area')).clipPath,
            columnClip: getComputedStyle(document.querySelector('.group-chat')).clipPath,
            inputClip: getComputedStyle(document.querySelector('.chat-input-area')).clipPath,
            inputWidth: document.querySelector('.chat-input-area').getBoundingClientRect().width,
            editorWidth: document.querySelector('.editor').getBoundingClientRect().width,
            finalWidth: document.querySelector('.group-chat').getBoundingClientRect().width,
            materialWidth: parseFloat(getComputedStyle(document.querySelector('.chat-input-area'), '::before').width) * new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.chat-input-area'), '::before').transform).m11,
            materialRadius: getComputedStyle(document.querySelector('.chat-input-area'), '::before').borderRadius,
            paneVisible: getComputedStyle(document.querySelector('.group-box__container')).visibility,
            sendRight: document.querySelector('.send-msg').getBoundingClientRect().right,
            oldRight: document.querySelector('.group-chat').getBoundingClientRect().left + oldWidth,
            slideState: (document.querySelector('.liuli-pane-transition')?.shadowRoot.getAnimations()[0] || document.querySelector('.group-box__container').getAnimations().find(animation => animation.id === 'liuli-side-pane-motion'))?.playState,
            surfaceEasing: document.querySelector('.chat-input-area').getAnimations({ subtree: true }).find(animation => animation.id === 'liuli-side-input-surface')?.effect.getTiming().easing,
            surfaceTarget: document.querySelector('.chat-input-area').getAnimations({ subtree: true }).find(animation => animation.id === 'liuli-side-input-surface')?.effect.pseudoElement,
            paneEasing: (document.querySelector('.liuli-pane-transition')?.shadowRoot.getAnimations() || document.querySelector('.group-box__container').getAnimations()).find(animation => animation.id === 'liuli-side-pane-motion')?.effect.getTiming().easing,
            inputDimensionAnimations: document.querySelector('.chat-input-area').getAnimations().filter(animation => animation.effect.getKeyframes().some(frame => frame.maxWidth || frame.minWidth || frame.width)).length,
            inputHeight: document.querySelector('.chat-input-area').getBoundingClientRect().height
          }), oldWidth);
          assert.equal(held.opacity, '0');
          if (wasGroup) assert.notEqual(held.clip, 'none', 'Cold layout expansion was exposed before reveal');
          else assert.equal(held.paneVisible, 'hidden', 'First group pane flashed before its entrance');
          assert.equal(held.columnClip, 'none', 'Column clipping changed the input glass backdrop');
          assert.equal(held.inputClip, 'none', 'Input clipping cut away its original rounded edge');
          assert(Math.abs(held.inputWidth - held.finalWidth) < 1, 'Input root must retain destination native layout: ' + JSON.stringify({ id, oldWidth, held }));
          assert(Math.abs(held.materialWidth - oldWidth) < 1, 'Input pseudo material expanded before pane reveal');
          assert.equal(held.materialRadius, '14px');
          assert.equal(held.slideState, 'paused', 'Pane left before destination messages were ready');
          assert.equal(held.inputHeight, name.includes('native-boundary') ? 160 : 44);
          assert.equal(held.surfaceEasing, held.paneEasing, 'Input material and pane must share one easing');
          assert.equal(held.surfaceTarget, '::before');
          assert.equal(held.inputDimensionAnimations, 0, 'Input root geometry must not animate');
          assert(Math.abs(held.sendRight - held.oldRight) < 1, 'Send button jumped to the final width before reveal');
          const finalWidth = await page.locator('.group-chat').evaluate(element => element.getBoundingClientRect().width);
          assert(wasGroup ? finalWidth > oldWidth : finalWidth < oldWidth, 'Native routing was blocked by pane motion');
          if (name === 'cold-distinct-conversations' && ['p1', 'g1'].includes(id) || name.includes('native-boundary')) {
            await inspectBoundary(page, wasGroup ? 'exit' : 'enter', id + (name.includes('native-boundary') ? '-native' : ''), report);
          }
          if (name === 'legacy-glass-clip') {
            const before = await page.locator('.chat-input-area').screenshot();
            await page.evaluate(() => {
              window.legacyClip = document.querySelector('.aio').animate([
                { clipPath: 'inset(-8px 188px -8px -8px)' }, { clipPath: 'inset(-8px)' }
              ], { duration: 300, fill: 'backwards' });
              window.legacyClip.pause();
              window.legacyClip.currentTime = 100;
            });
            assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.aio')).clipPath), 'none');
            const during = await page.locator('.chat-input-area').screenshot();
            fs.writeFileSync(path.join(output, 'legacy-clip-baseline-input.png'), before);
            fs.writeFileSync(path.join(output, 'legacy-clip-protected-input.png'), during);
            const pixels = await page.evaluate(async images => {
              const read = async data => {
                const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width; canvas.height = bitmap.height;
                const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
                return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
              };
              const [a, b] = await Promise.all(images.map(read));
              let difference = 0, channels = 0;
              for (let y = 10; y < a.height - 10; y++) for (let x = 128; x < a.width - 64; x++) for (let c = 0; c < 3; c++) {
                const i = (y * a.width + x) * 4 + c;
                difference += Math.abs(a.data[i] - b.data[i]); channels++;
              }
              return { meanDifference: difference / channels, sameSize: a.width === b.width && a.height === b.height };
            }, [before.toString('base64'), during.toString('base64')]);
            assert(pixels.sameSize && pixels.meanDifference < 0.5, 'Legacy clipping changed painted input glass: ' + JSON.stringify(pixels));
          }
          if (['resize', 'reverse-resize', 'preference-change', 'disposal', 'reinjection', 'drag'].includes(name)) {
            if (name.endsWith('resize')) await page.setViewportSize({ width: 1010, height: 760 });
            if (name === 'preference-change') await page.emulateMedia({ reducedMotion: 'reduce' });
            if (name === 'disposal') await page.evaluate(() => window.__liuliSidePaneMotion.dispose());
            if (name === 'reinjection') await page.addScriptTag({ content: scripts.at(-1) });
            if (name === 'drag') await page.locator('[data-contact-id=p1]').dispatchEvent('dragstart', { bubbles: true });
            await page.waitForFunction(() => !window.__liuliSidePaneMotion?.running);
          }
        }
        if (name.endsWith('layout-before-title')) await page.evaluate(() => window.finishTitle());
        await page.evaluate(id => window.messages(id), id);
        if (name !== 'reduced-motion') await page.waitForFunction(() => !document.querySelector('.chat-msg-area').hasAttribute('data-ll-switching'));
        if (name.endsWith('long-reveal-task')) {
          await page.waitForFunction(() => window.revealAfterBlock);
          const afterBlock = await page.evaluate(() => window.revealAfterBlock);
          assert(afterBlock.panePresent, 'Long route work consumed the pane transition before its first frame');
          assert(afterBlock.slideTime < 100, 'Pane used a stale document timeline timestamp');
          assert.equal(afterBlock.slideStart, afterBlock.entryStart, 'Pane and message entry did not begin on the same render');
        }
        await page.waitForFunction(() => !window.__liuliSidePaneMotion?.running);
        const final = await page.evaluate(() => ({ opacity: getComputedStyle(document.querySelector('.chat-msg-area')).opacity,
          clip: getComputedStyle(document.querySelector('.group-chat')).clipPath, inputClip: getComputedStyle(document.querySelector('.chat-input-area')).clipPath,
          inputMax: getComputedStyle(document.querySelector('.chat-input-area')).maxWidth,
          materialWidth: parseFloat(getComputedStyle(document.querySelector('.chat-input-area'), '::before').width) * new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.chat-input-area'), '::before').transform).m11,
          inputWidth: document.querySelector('.chat-input-area').getBoundingClientRect().width,
          inputShadow: getComputedStyle(document.querySelector('.chat-input-area')).boxShadow,
          nativeInputShadow: window.nativeInputShadow,
          nativeMaterialShadow: window.nativeMaterialShadow,
          materialShadow: getComputedStyle(document.querySelector('.chat-input-area'), '::before').boxShadow,
          pseudoTransform: getComputedStyle(document.querySelector('.chat-input-area'), '::before').transform,
          rootTransform: getComputedStyle(document.querySelector('.chat-input-area')).transform,
          editorTransform: getComputedStyle(document.querySelector('.editor')).transform,
          controlTransform: getComputedStyle(document.querySelector('.send-msg')).transform,
          shadowVariable: document.querySelector('.chat-input-area').style.getPropertyValue('--ll-side-input-shadow'),
          sendTranslate: getComputedStyle(document.querySelector('.send-msg')).translate,
          minRestored: getComputedStyle(document.querySelector('.chat-input-area')).minWidth === window.nativeInputMin,
          paneTransform: getComputedStyle(document.querySelector('.group-box__container')).transform,
          paneVisible: getComputedStyle(document.querySelector('.group-box__container')).visibility,
          aioClip: getComputedStyle(document.querySelector('.aio')).clipPath,
          motionFlags: document.querySelectorAll('[data-liuli-side-motion], [data-liuli-side-wait], [data-liuli-pane-retained], [data-liuli-input-motion]').length,
          inputHeight: document.querySelector('.chat-input-area').getBoundingClientRect().height,
          editorSame: document.querySelector('.editor') === window.originalEditor && window.originalEditor.innerHTML === window.originalDraft }));
        assert.equal(final.clip, 'none');
        assert.equal(final.inputClip, 'none');
        assert.equal(final.inputMax, 'none');
        assert(Math.abs(final.materialWidth - final.inputWidth) < 0.1, 'Input material did not recover natural width');
        assert.equal(final.inputShadow, final.nativeInputShadow, 'Input root shadow did not recover');
        assert.equal(final.materialShadow, final.nativeMaterialShadow, 'Input material shadow did not recover');
        assert.equal(final.pseudoTransform, 'none');
        assert.equal(final.rootTransform, 'none');
        assert.equal(final.editorTransform, 'none');
        assert.equal(final.controlTransform, 'none');
        assert.equal(final.shadowVariable, '');
        assert.equal(final.sendTranslate, 'none');
        assert(final.minRestored);
        assert.equal(final.paneTransform, 'none');
        assert.equal(final.paneVisible, 'visible');
        assert.equal(final.aioClip, 'none');
        assert.equal(final.motionFlags, 0);
        assert.equal(final.inputHeight, name.includes('native-boundary') ? 160 : 44);
        assert(final.editorSame);
        await page.waitForTimeout(350);
        assert.equal(await page.locator('.chat-msg-area').evaluate(element => getComputedStyle(element).opacity), '1');
      }
      const result = await page.evaluate(() => ({ events: window.nativeEvents, visited: window.visited,
        editorSame: document.querySelector('.editor') === window.originalEditor && window.originalEditor.innerHTML === window.originalDraft,
        legacyMask: document.body.hasAttribute('data-liuli-side-switch'), tempWidth: document.body.style.getPropertyValue('--ll-side-old-width') }));
      assert(result.events.every(event => event.same), 'Original native event was replaced or replayed');
      assert.equal(result.legacyMask, false);
      assert.equal(result.tempWidth, '');
      assert(result.editorSame);
      assert.deepEqual(errors, []);
      report.cases.push({ name, passed: true, visited: result.visited, nativeEvents: result.events.length });
      if (name === 'reverse-native-boundary') report.compositorEvidence = await inspectSurfaceCompositing(page);
      await page.close();
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'controller-integration-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
