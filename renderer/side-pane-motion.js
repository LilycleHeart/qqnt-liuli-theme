(() => {
  window.__liuliSidePaneMotion?.dispose();
  document.querySelectorAll('[data-liuli-side-motion], [data-liuli-side-wait], [data-liuli-input-motion]').forEach(element => {
    element.removeAttribute('data-liuli-side-motion');
    element.removeAttribute('data-liuli-side-wait');
    element.removeAttribute('data-liuli-input-motion');
    element.style.removeProperty('--ll-side-input-shadow');
  });
  document.body.removeAttribute('data-liuli-side-switch');
  document.body.removeAttribute('data-liuli-pane-exit');
  document.body.style.removeProperty('--ll-side-old-width');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const DURATION = 180;
  // Respond quickly, then settle gently. Every moving boundary keeps this same
  // curve and clock so easing cannot separate the pane from the input surface.
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  let round = null;
  const styleCopies = new WeakMap();
  let sheets = [], isolatedStyles = false;

  function syncStyles() {
    const next = [];
    isolatedStyles = true;
    try {
      for (const source of document.styleSheets) {
        if (source.disabled) continue;
        const rules = source.cssRules;
        const version = source.href ? source.href + ':' + rules.length : source.ownerNode.textContent;
        let copy = styleCopies.get(source);
        if (!copy || copy.version !== version) {
          const sheet = new CSSStyleSheet();
          const text = [...rules].map(rule => rule.cssText).join('\n');
          const media = source.media.mediaText;
          sheet.replaceSync(media ? '@media ' + media + '{' + text + '}' : text);
          copy = { version, sheet };
          styleCopies.set(source, copy);
        }
        next.push(copy.sheet);
      }
    } catch (_) { isolatedStyles = false; }
    sheets = next;
  }
  // These are shared style definitions, never conversation snapshots. Preparing
  // them when CSS loads avoids thousands of computed-style reads on pointerdown.
  const styleObserver = new MutationObserver(() => { syncStyles(); measureGeometry(); });
  styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['href', 'media', 'disabled'] });
  const stylesheetLoaded = event => { if (event.target.matches?.('link[rel=stylesheet]')) { syncStyles(); measureGeometry(); } };
  document.addEventListener('load', stylesheetLoaded, true);
  syncStyles();
  const scrollPositions = new WeakMap();
  let geometry = null;
  function measureGeometry() {
    if (!geometry) return;
    const aio = geometry.pane.closest('.aio');
    if (!geometry.pane.isConnected || !geometry.column.isConnected || !aio) {
      layoutObserver.disconnect();
      geometry = null;
      return;
    }
    geometry.aio = aio;
    geometry.paneRect = geometry.pane.getBoundingClientRect();
    geometry.columnRect = geometry.column.getBoundingClientRect();
    geometry.aioRect = aio.getBoundingClientRect();
    const material = geometry.pane.querySelector('.group-box');
    if (material) {
      const appearance = getComputedStyle(material);
      geometry.material = { radius: appearance.borderRadius, shadow: appearance.boxShadow };
    }
    const app = document.querySelector('#app');
    geometry.appColor = app ? getComputedStyle(app).backgroundColor : 'transparent';
    for (const element of geometry.pane.querySelectorAll('.q-scroll-view, .group-member, .group-member-list')) {
      scrollPositions.set(element, [element.scrollTop, element.scrollLeft]);
    }
  }
  const layoutObserver = new ResizeObserver(() => {
    measureGeometry();
    if (round) { try { update(round); } catch (_) { abort(); } }
  });
  function trackGeometry() {
    const pane = document.querySelector('.aio .group-box__container');
    const column = document.querySelector('.aio .chat-msg-area')?.parentElement;
    if (!pane || !column) {
      layoutObserver.disconnect();
      geometry = null;
      if (round && !round.aio.isConnected) abort();
      return;
    }
    if (geometry?.pane === pane && geometry.column === column) return;
    layoutObserver.disconnect();
    geometry = { pane, column };
    layoutObserver.observe(pane);
    layoutObserver.observe(column);
    measureGeometry();
  }
  const structureObserver = new MutationObserver(trackGeometry);
  structureObserver.observe(document.body, { childList: true, subtree: true });
  function rememberScroll(event) {
    if (geometry?.pane.contains(event.target)) scrollPositions.set(event.target, [event.target.scrollTop, event.target.scrollLeft]);
  }
  document.addEventListener('scroll', rememberScroll, { capture: true, passive: true });
  trackGeometry();

  function finish(state) {
    if (!state || state.done) return;
    state.done = true;
    clearTimeout(state.timeout);
    state.observer.disconnect();
    for (const animation of state.animations) animation.cancel();
    for (const input of state.inputs) {
      input.removeAttribute('data-liuli-input-motion');
      input.style.removeProperty('--ll-side-input-shadow');
    }
    // An already-open QQ may still run the older index.js closure. Its extra
    // whole-aio clip makes the input lose its wallpaper backdrop. The CSS guard
    // suppresses it throughout the switch; retire only that legacy effect before
    // removing the guard, without replacing the native controller or listeners.
    for (const animation of state.aio.getAnimations()) {
      const timing = animation.effect?.getTiming();
      const frames = animation.effect?.getKeyframes();
      if (timing?.duration === 300 && timing.fill === 'backwards' && frames?.length === 2 &&
        frames[0].clipPath?.startsWith('inset(-8px ') && frames[1].clipPath === 'inset(-8px)') animation.cancel();
    }
    state.overlay?.remove();
    state.pane.removeAttribute('data-liuli-pane-retained');
    state.aio.removeAttribute('data-liuli-side-motion');
    state.aio.removeAttribute('data-liuli-side-wait');
    if (round === state) round = null;
    // The next opposite switch starts from the destination's natural geometry.
    measureGeometry();
  }
  function abort() { finish(round); }

  function computedSnapshot(state) {
    // Capture the current card synchronously. First visits use the same path as
    // subsequent visits: no image fetch, idle preparation, canvas, or cache gate.
    const properties = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height',
      'max-width', 'max-height', 'top', 'right', 'bottom', 'left', 'margin', 'padding', 'border',
      'border-radius', 'box-shadow', 'background', 'backdrop-filter', 'color', 'font', 'letter-spacing',
      'text-align', 'text-overflow', 'text-shadow', 'text-decoration', 'white-space', 'word-break',
      'overflow-wrap', 'opacity', 'visibility', 'overflow', 'overflow-clip-margin', 'flex',
      'flex-direction', 'flex-wrap', 'align-items', 'align-self', 'justify-content', 'gap',
      'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'transform',
      'transform-origin', 'object-fit', 'object-position', 'vertical-align', 'z-index', 'fill', 'stroke',
      'stroke-width', 'filter', 'clip-path'];
    const originals = [state.pane, ...state.pane.querySelectorAll('*')];
    const resolved = originals.map(element => {
      const computed = getComputedStyle(element);
      const css = properties.map(property => property + ':' + computed.getPropertyValue(property)).join(';');
      const pseudos = ['::before', '::after'].flatMap(pseudo => {
        const appearance = getComputedStyle(element, pseudo);
        if (!appearance.content || ['none', 'normal'].includes(appearance.content)) return [];
        return [[pseudo, 'content:' + appearance.content + ';' +
          properties.map(property => property + ':' + appearance.getPropertyValue(property)).join(';')]];
      });
      return { css, pseudos, top: element.scrollTop, left: element.scrollLeft };
    });
    const rect = state.paneRect;
    const overlay = document.createElement('div');
    overlay.className = 'liuli-pane-transition';
    overlay.inert = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:160;overflow:clip;contain:layout style;' +
      'left:' + (rect.left - 12) + 'px;top:' + (rect.top - 8) + 'px;width:' + (rect.width + 24) +
      'px;height:' + (rect.height + 16) + 'px;';
    overlay.style.width = Math.max(0, state.aioRect.right - rect.left + 12) + 'px';
    const shadow = overlay.attachShadow({ mode: 'open' });
    const moving = document.createElement('div');
    moving.style.cssText = 'position:absolute;left:12px;top:8px;will-change:transform;width:' + rect.width + 'px;height:' + rect.height + 'px;';
    const clone = state.pane.cloneNode(true);
    const copies = [clone, ...clone.querySelectorAll('*')];
    const pseudoRules = [];
    copies.forEach((element, index) => {
      element.removeAttribute('id');
      element.style.cssText = resolved[index].css;
      if (resolved[index].pseudos.length) {
        element.dataset.llPaneCopy = String(index);
        for (const [pseudo, css] of resolved[index].pseudos) pseudoRules.push('[data-ll-pane-copy="' + index + '"]' + pseudo + '{' + css + '}');
      }
    });
    const style = document.createElement('style');
    style.textContent = pseudoRules.join('\n');
    clone.style.margin = '0';
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    moving.appendChild(clone);
    shadow.append(style, moving);
    document.body.appendChild(overlay);
    copies.forEach((element, index) => {
      if (resolved[index].top) element.scrollTop = resolved[index].top;
      if (resolved[index].left) element.scrollLeft = resolved[index].left;
    });
    state.overlay = overlay;
    state.moving = moving;
  }
  function snapshot(state) {
    if (!isolatedStyles) return computedSnapshot(state);
    const rect = state.paneRect;
    const originals = [state.pane, ...state.pane.querySelectorAll('*')];
    const scroll = originals.map(element => scrollPositions.get(element) || [0, 0]);
    const overlay = document.createElement('div');
    overlay.className = 'liuli-pane-transition';
    overlay.inert = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:160;overflow:clip;contain:layout style;' +
      'left:' + (rect.left - 12) + 'px;top:' + (rect.top - 8) + 'px;width:' + (rect.width + 24) +
      'px;height:' + (rect.height + 16) + 'px;';
    overlay.style.width = Math.max(0, state.aioRect.right - rect.left + 12) + 'px';
    const shadow = overlay.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = sheets;
    const style = document.createElement('style');
    style.textContent = '*{animation:none!important;transition:none!important;pointer-events:none!important}' +
      '[data-ll-pane-ancestor]{display:contents!important}' +
      '[data-ll-pane-ancestor]::before,[data-ll-pane-ancestor]::after{content:none!important}' +
      // The isolated app needs its original wallpaper behind the glass. Retain
      // its viewport coordinates so the card does not change material on copy.
      '#app[data-ll-pane-ancestor]::before{content:""!important;position:absolute!important;inset:auto!important;' +
      'left:' + (-rect.left) + 'px!important;top:' + (-rect.top) + 'px!important;width:' + innerWidth +
      'px!important;height:' + innerHeight + 'px!important;z-index:-1!important;background-color:' + state.appColor + '!important}';
    const moving = document.createElement('div');
    moving.style.cssText = 'position:absolute;left:12px;top:8px;will-change:transform;width:' + rect.width + 'px;height:' + rect.height + 'px;';
    moving.style.overflow = 'clip';
    moving.style.borderRadius = state.material?.radius || '14px';
    moving.style.boxShadow = state.material?.shadow || 'none';
    const clone = state.pane.cloneNode(true);
    clone.removeAttribute('data-liuli-pane-retained');
    clone.style.cssText += ';position:absolute!important;inset:0!important;margin:0!important;width:' + rect.width + 'px!important;height:' + rect.height + 'px!important;';
    const copies = [clone, ...clone.querySelectorAll('*')];
    let branch = clone;
    // Retain selector ancestry inside the shadow boundary. Document queries and
    // QQ's observers cannot mistake these inert copies for live chat controls.
    for (let ancestor = state.pane.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const shell = ancestor.cloneNode(false);
      shell.setAttribute('data-ll-pane-ancestor', '');
      shell.appendChild(branch);
      branch = shell;
    }
    moving.appendChild(branch);
    shadow.append(style, moving);
    document.body.appendChild(overlay);
    copies.forEach((element, index) => {
      if (scroll[index][0]) element.scrollTop = scroll[index][0];
      if (scroll[index][1]) element.scrollLeft = scroll[index][1];
    });
    state.overlay = overlay;
    state.moving = moving;
  }
  function animate(state, element, frames, options = {}) {
    const animation = element.animate(frames, {
      duration: options.duration ?? DURATION,
      easing: options.easing ?? EASE,
      fill: 'both',
      ...(options.pseudoElement ? { pseudoElement: options.pseudoElement } : {})
    });
    animation.pause();
    animation.currentTime = 0;
    if (state.started) {
      animation.play();
      animation.ready.then(() => {
        if (!state.done && state.slide.startTime !== null) animation.startTime = state.slide.startTime;
      }, () => {});
    }
    state.animations.push(animation);
    return animation;
  }
  function alignControls(state, column) {
    const controls = [...column.querySelectorAll('.message-container--self')];
    for (const element of controls) {
      if (state.aligned.has(element)) continue;
      state.aligned.add(element);
      animate(state, element, [{ translate: -state.delta + 'px 0' }, { translate: '0px 0' }]);
    }
  }
  function holdLayout(state, area, column) {
    if (state.direction === 'exit' && !state.areas.has(area)) {
      state.areas.add(area);
      // Keep clipping away from the input's glass and shadow. Clipping the
      // whole column changes their backdrop and cuts off the old rounded edge.
      animate(state, area, [
        { clipPath: 'inset(-8px ' + Math.max(0, state.delta - 8) + 'px -8px -8px)' },
        { clipPath: 'inset(-8px -8px -8px -8px)' }
      ]);
    }
    const input = [...column.querySelectorAll('.chat-input-area')].find(element => element.querySelector('[contenteditable=true]'));
    if (input && !state.inputs.has(input)) {
      state.inputs.add(input);
      // QQ lays out the destination editor once. Animate its glass pseudo-layer
      // directly so the compositor can advance it during cold-route main-thread
      // work. Text, buttons and the editor itself are never scaled or reflowed.
      // This surface and the pane use the very same width difference and clock.
      const finalWidth = input.getBoundingClientRect().width;
      input.setAttribute('data-liuli-input-motion', '');
      const surface = animate(state, input, [
        { transform: 'scaleX(' + ((finalWidth - state.delta) / finalWidth) + ')' },
        { transform: 'scaleX(1)' }
      ], { pseudoElement: '::before' });
      surface.id = 'liuli-side-input-surface';
      const editor = input.querySelector(':scope > .msg-input');
      if (editor && state.delta > 0) {
        // Only editor content needs a crop while its new, wider layout is
        // revealed. The glass remains outside this backdrop-root boundary.
        const crop = animate(state, editor, [
          { clipPath: 'inset(0 ' + state.delta + 'px 0 0)' },
          { clipPath: 'inset(0)' }
        ]);
        crop.id = 'liuli-side-input-content';
      }
      for (const control of input.querySelectorAll(':scope > .operation, :scope > .send-msg')) {
        const movement = animate(state, control, [{ translate: -state.delta + 'px 0' }, { translate: '0px 0' }]);
        movement.id = 'liuli-side-input-controls';
      }
    }
    if (state.direction === 'exit') alignControls(state, column);
  }
  function incomingPane(state) {
    const pane = document.querySelector('.aio .group-box__container');
    if (!pane?.querySelector('.group-box') || state.panes.has(pane)) return;
    state.panes.add(pane);
    // Keep the live incoming card so late member/notice updates remain visible.
    // Only the outgoing card needs a copy, since QQ destroys its contents.
    const slide = animate(state, pane, [
      { transform: 'translateX(' + -state.delta + 'px)' },
      { transform: 'translateX(0)' }
    ]);
    slide.id = 'liuli-side-pane-motion';
    if (!state.slide) state.slide = slide;
  }
  function update(state) {
    if (state.done) return;
    const area = document.querySelector('.aio .chat-msg-area');
    const column = area?.parentElement;
    if (!column) return;
    if (state.prepared) {
      if (state.direction === 'enter') incomingPane(state);
      holdLayout(state, area, column);
      if (!area.hasAttribute('data-ll-switching')) reveal(state);
      return;
    }
    const rect = column.getBoundingClientRect();
    const delta = rect.right - state.columnRect.right;
    if (state.direction === 'exit' ? delta < 2 : delta > -2) return;
    const pane = document.querySelector('.aio .group-box__container');
    if (state.direction === 'enter' && (!pane?.querySelector('.group-box') || pane.getBoundingClientRect().width <= 2)) return;
    state.prepared = true;
    state.delta = delta;
    // Native routing already happened. Cover its final layout before painting,
    // then slide the old card and reveal the message/input column on one clock.
    if (state.direction === 'exit') {
      state.slide = animate(state, state.moving, [
        { transform: 'translateX(0)' },
        { transform: 'translateX(' + state.delta + 'px)' }
      ]);
      state.slide.id = 'liuli-side-pane-motion';
    } else incomingPane(state);
    holdLayout(state, area, column);
    if (!area.hasAttribute('data-ll-switching')) reveal(state);
  }
  function reveal(state) {
    if (!state || state.done || state.started || !state.prepared) return;
    state.started = true;
    clearTimeout(state.timeout);
    state.aio.removeAttribute('data-liuli-side-wait');
    // Pending play operations resolve together at the next render opportunity.
    // document.timeline.currentTime can still refer to the frame preceding a
    // long QQ route task; assigning it here would skip the whole transition.
    for (const animation of state.animations) animation.play();
    state.slide.finished.then(() => finish(state), () => finish(state));
  }
  function pointerdown(event) {
    if (round && event.target.closest?.('.chat-input-area')) { abort(); return; }
    const item = event.target.closest?.('.recent-contact-item');
    if (event.button !== 0 || !item || item.closest('.viewport-list__measure')) return;
    if (item.querySelector(':scope > .liuli-pin-heading') && event.clientY - item.getBoundingClientRect().top <= 28) return;
    abort();
    if (item.classList.contains('recent-contact-item--selected')) return;
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || document.hidden || preference.matches) return;
    const type = window.LiuliQQ.contactType(item);
    const pane = geometry?.pane;
    if (!pane?.isConnected) return;
    // Re-clicking a selected chat closes the whole aio. Reopening that hidden
    // view has no painted column to transition from; zero-width geometry is not
    // a private chat. The inline guard also covers a reopen before ResizeObserver
    // has delivered the collapsed dimensions, without forcing layout on input.
    const aio = geometry.aio;
    if (!aio?.isConnected || !geometry.column.isConnected || aio.style.display === 'none' ||
      geometry.aioRect.width <= 2 || geometry.aioRect.height <= 2 ||
      geometry.columnRect.width <= 2 || geometry.columnRect.height <= 2) return;
    const hasGroup = !!pane.querySelector('.group-box') && geometry.paneRect.width > 2;
    const direction = type === 1 && hasGroup ? 'exit' : type === 2 && !hasGroup ? 'enter' : null;
    if (!direction) return;
    if (document.querySelector('.aio .chat-input-area .chat-func-bar.liuli-expanded')) return;
    const expression = document.querySelector('.aio .chat-input-area .expression-panel:not(:empty)');
    if (expression?.getBoundingClientRect().height > 2) return;
    // Geometry tracks the currently painted pane, including its first layout.
    // Reading it here would force QQ's pending style work into the input event.
    const state = { pane, aio, aioRect: geometry.aioRect,
      direction, paneRect: geometry.paneRect, columnRect: geometry.columnRect,
      material: geometry.material, appColor: geometry.appColor,
      animations: [], aligned: new WeakSet(), areas: new WeakSet(), inputs: new Set(), panes: new WeakSet(), observer: null };
    state.observer = new MutationObserver(() => { try { update(state); } catch (_) { finish(state); } });
    try {
      state.aio.setAttribute('data-liuli-side-motion', direction);
      state.aio.setAttribute('data-liuli-side-wait', '');
      if (direction === 'exit') {
        snapshot(state);
        pane.setAttribute('data-liuli-pane-retained', '');
      }
      round = state;
      state.observer.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-ll-switching'] });
      state.timeout = setTimeout(() => finish(state), 4000);
    } catch (_) { finish(state); }
  }
  window.addEventListener('pointerdown', pointerdown, { capture: true, passive: true });
  window.addEventListener('resize', abort);
  window.addEventListener('dragstart', abort, { capture: true, passive: true });
  window.addEventListener('hashchange', abort);
  document.addEventListener('visibilitychange', abort);
  preference.addEventListener('change', abort);
  // Message exits belong to index.js for both cold and repeated visits. There is
  // deliberately no `active` flag that could cause its old controller to skip them.
  window.__liuliSidePaneMotion = { get running() { return !!round; }, messageReady() {
    try { if (round) { update(round); reveal(round); } } catch (_) { abort(); }
  }, dispose() {
    abort();
    styleObserver.disconnect();
    structureObserver.disconnect();
    layoutObserver.disconnect();
    document.removeEventListener('scroll', rememberScroll, true);
    document.removeEventListener('load', stylesheetLoaded, true);
    window.removeEventListener('pointerdown', pointerdown, true);
    window.removeEventListener('resize', abort);
    window.removeEventListener('dragstart', abort, true);
    window.removeEventListener('hashchange', abort);
    document.removeEventListener('visibilitychange', abort);
    preference.removeEventListener('change', abort);
    delete window.__liuliSidePaneMotion;
  } };
})();
