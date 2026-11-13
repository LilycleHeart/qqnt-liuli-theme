// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  const motion = window.LiuliMotion;
  const {
    installLayout,
    applyBar,
    nativeBarItem,
    applyAll: llLayoutPass,
    buildLayoutSection
  } = window.LiuliLayout;
  const { installArkExternal } = window.LiuliArk;
  const { ROLE_KEY, loadRoles, roleVars, accentPalette, buildRoleControls } = window.LiuliRoles;
  const {
    installDiagRuntime,
    beginBoot,
    markBootReady,
    markBootFailed,
    auditWallpaper,
    collectDiagnostics,
    getErrors,
    getErrorCount,
    buildExportPayload,
    setImageRatioReader,
    noteThemeFailure,
    notePanelBuild
  } = window.LiuliDiag;
  beginBoot();
  installDiagRuntime();
  const FILES = [
    'wallpaper.css',
    'qq-tokens.css',
    'palette.css',
    'liuli.css',
    'typography.css',
    'panel.css',
    'settings-page.css',
    'details.css',
    'no-dividers.css',
    'input-bar.css',
    'bubbles.css',
    'layout.css',
    'lists.css',
    'motion.css',
    'scroll-time.css',
    'markdown.css',
    'layout-custom.css',
    'integration.css',
    // 置顶会话分组（#55）：排在最后，才能在 typography.css 的
    // .recent-contact-item::before/after { display:none !important } 之后接管
    // 行的两个伪元素。
    'pin-groups.css'
  ];
  const STYLE_ID = 'liuli-dsh-theme';
  const WALLPAPER = window.LiuliHost.wallpaper;
  const OPTIONAL_FILES = new Set(['wallpaper.css']);
  const DEFAULT_SOURCE = '#1d9bf0';
  function llNormalizeColorSeed(value) {
    if (typeof value !== 'string') return null;
    const seed = value.trim();
    return /^#[0-9a-f]{6}$/i.test(seed) ? seed.toLowerCase() : null;
  }
  let refreshPaletteInfo = () => {};
  let refreshDiagnosticErrors = () => {};
  let refreshInputGeometry = () => {};
  window.addEventListener('liuli-errors', () => refreshDiagnosticErrors());
  function installRouteScope() {
    if (window.__liuliRouteScope) return;
    window.__liuliRouteScope = true;
    const body = document.body;
    const sync = () => {
      const hash = location.hash || '';
      const path = location.pathname || '';
      if (body.dataset.hash !== hash) body.dataset.hash = hash;
      if (body.dataset.pathname !== path) body.dataset.pathname = path;
      if (body.style.getPropertyValue('--hash') !== hash) body.style.setProperty('--hash', hash);
      if (body.style.getPropertyValue('--pathname') !== path)
        body.style.setProperty('--pathname', path);
      /* #49 / #52：通话、屏幕共享这些窗口都带原生视频层，主题不能在上面铺
       * 壁纸 / 材质 / isolation / 入场动画。除了已知的 #/av 和带 screen/share 的路由，
       * QQ 的屏幕共享壳窗口是 about:blank（hash 为空、没有 #/av），也要一并排除。 */
      const isAv =
        /^#\/av(\/|$)/.test(hash) || /screen|share/i.test(hash) || location.protocol === 'about:';
      if ((body.dataset.liuliAv === '1') !== isAv) {
        if (isAv) body.dataset.liuliAv = '1';
        else delete body.dataset.liuliAv;
      }
      const scope =
        hash.indexOf('#/setting') === 0
          ? 'setting'
          : hash.indexOf('#/main') === 0
            ? 'main'
            : hash === '' || hash === '#/blank'
              ? 'boot'
              : 'aux';
      if (body.dataset.liuliScope !== scope) {
        body.dataset.liuliScope = scope;
        window.dispatchEvent(new Event('liuli-scope'));
      }
    };
    sync();
    addEventListener('liuli-route', sync);
  }
  function chromaticSourceFromCanvas(ctx, w, h) {
    let px;
    try {
      px = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;
    }
    let best = {
      r: 29,
      g: 155,
      b: 240,
      score: -1
    };
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i],
        g = px[i + 1],
        b = px[i + 2],
        a = px[i + 3];
      if (a < 128) continue;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const chroma = max - min;
      const l = (max + min) / 2;
      if (l < 35 || l > 220) continue;
      const score = chroma - Math.abs(l - 128) * 0.4;
      if (score > best.score)
        best = {
          r,
          g,
          b,
          score
        };
    }
    const hex = v => v.toString(16).padStart(2, '0');
    return '#' + hex(best.r) + hex(best.g) + hex(best.b);
  }
  function chromaOf(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16),
      g = parseInt(h.slice(2, 4), 16),
      b = parseInt(h.slice(4, 6), 16);
    return Math.max(r, g, b) - Math.min(r, g, b);
  }
  // Keep only small metadata, sharing decode work while an image is loading.
  const imageMetadata = new Map();
  const pendingImages = new Map();
  function rememberImage(src, metadata) {
    imageMetadata.delete(src);
    imageMetadata.set(src, metadata);
    while (imageMetadata.size > 4) imageMetadata.delete(imageMetadata.keys().next().value);
    return metadata;
  }
  function readImageMetadata(src) {
    const cached = imageMetadata.get(src);
    if (cached?.source) return Promise.resolve(rememberImage(src, cached));
    if (pendingImages.has(src)) return pendingImages.get(src);
    const pending = (async () => {
      const img = new Image();
      if (img.decode) {
        img.src = src;
        await img.decode();
      } else {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = src;
        });
      }
      const ratio =
        img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null;
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      let source = DEFAULT_SOURCE;
      if (ctx) {
        ctx.drawImage(img, 0, 0, size, size);
        const picked = chromaticSourceFromCanvas(ctx, size, size);
        if (picked && chromaOf(picked) >= 24) source = picked;
      }
      return rememberImage(src, { ratio, source });
    })().finally(() => pendingImages.delete(src));
    pendingImages.set(src, pending);
    return pending;
  }
  async function extractSource() {
    const src = loadWallpaperState().src || WALLPAPER;
    return src ? (await readImageMetadata(src)).source : DEFAULT_SOURCE;
  }
  const SURFACE_TONES = {
    light: {
      appBg: 98,
      low: 96,
      mid: 94,
      high: 92,
      highest: 90
    },
    dark: {
      appBg: 6,
      low: 10,
      mid: 12,
      high: 17,
      highest: 22
    }
  };
  const SCRIM = {
    low: 0.05,
    mid: 0.08,
    high: 0.11,
    highest: 0.14
  };
  function rgbTriplet(hex) {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ');
  }
  function alphaComposite(fg, bg, a) {
    const ph = fg.replace('#', ''),
      bh = bg.replace('#', '');
    const out = [0, 2, 4].map(i => {
      const p = parseInt(ph.slice(i, i + 2), 16);
      const b = parseInt(bh.slice(i, i + 2), 16);
      return Math.round(a * p + (1 - a) * b)
        .toString(16)
        .padStart(2, '0');
    });
    return '#' + out.join('');
  }
  function deriveVars(mcu, theme, isDark, roles) {
    const s = isDark ? theme.schemes.dark : theme.schemes.light;
    const acc =
      roles && (roles.accent === 'secondary' || roles.accent === 'tertiary')
        ? roles.accent
        : 'primary';
    const tp = accentPalette(theme, roles);
    const neutral = theme.palettes.neutral;
    const nv = theme.palettes.neutralVariant;
    const st = SURFACE_TONES[isDark ? 'dark' : 'light'];
    const sc = t => mcu.hexFromArgb(neutral.tone(t));
    const primary = mcu.hexFromArgb(s[acc]);
    const onPrimary = mcu.hexFromArgb(s['on' + acc.charAt(0).toUpperCase() + acc.slice(1)]);
    const cLow = sc(st.low),
      cMid = sc(st.mid),
      cHigh = sc(st.high),
      cHighest = sc(st.highest);
    const glass2 = mcu.hexFromArgb(s.onSurfaceVariant);
    return {
      '--ll-brand': primary,
      '--ll-brand-rgb': rgbTriplet(primary),
      '--ll-brand-hover': mcu.hexFromArgb(tp.tone(isDark ? 76 : 44)),
      '--ll-brand-pressed': mcu.hexFromArgb(tp.tone(isDark ? 84 : 36)),
      '--ll-brand-tint': mcu.hexFromArgb(tp.tone(isDark ? 24 : 90)),
      '--ll-brand-weak': mcu.hexFromArgb(tp.tone(isDark ? 32 : 88)),
      '--ll-brand-line': mcu.hexFromArgb(tp.tone(isDark ? 48 : 60)),
      '--ll-on-brand': onPrimary,
      '--ll-on-brand-rgb': rgbTriplet(onPrimary),
      '--ll-secondary': mcu.hexFromArgb(s.secondary),
      '--ll-tertiary': mcu.hexFromArgb(s.tertiary),
      '--ll-tertiary-container': mcu.hexFromArgb(s.tertiaryContainer),
      '--ll-on-tertiary-container': mcu.hexFromArgb(s.onTertiaryContainer),
      '--ll-secondary-container': mcu.hexFromArgb(s.secondaryContainer),
      '--ll-on-secondary-container': mcu.hexFromArgb(s.onSecondaryContainer),
      '--ll-on-glass': mcu.hexFromArgb(s.onSurface),
      '--ll-on-glass-rgb': rgbTriplet(mcu.hexFromArgb(s.onSurface)),
      '--ll-on-glass-2': glass2,
      '--ll-on-glass-2-rgb': rgbTriplet(glass2),
      '--ll-on-glass-3': mcu.hexFromArgb(nv.tone(isDark ? 66 : 40)),
      '--ll-name': mcu.hexFromArgb(s.tertiary),
      '--ll-link': primary,
      '--ll-on-glass-4': mcu.hexFromArgb(s.outlineVariant),
      '--ll-app-bg': sc(st.appBg),
      '--ll-surface-low': cLow,
      '--ll-surface-mid': cMid,
      '--ll-surface-high': cHigh,
      '--ll-surface-highest': cHighest,
      '--ll-surface-1': alphaComposite(primary, cLow, SCRIM.low),
      '--ll-surface-2': alphaComposite(primary, cMid, SCRIM.mid),
      '--ll-surface-3': alphaComposite(primary, cHigh, SCRIM.high),
      '--ll-surface-4': alphaComposite(primary, cHighest, SCRIM.highest),
      '--ll-acrylic': rgbTriplet(alphaComposite(primary, cMid, SCRIM.mid)),
      '--ll-acrylic-low': rgbTriplet(alphaComposite(primary, cLow, SCRIM.low)),
      '--ll-acrylic-high': rgbTriplet(alphaComposite(primary, cHighest, SCRIM.highest)),
      '--ll-stroke-1': mcu.hexFromArgb(s.outline),
      '--ll-stroke-2': mcu.hexFromArgb(s.outlineVariant),
      '--ll-stroke-3': mcu.hexFromArgb(nv.tone(isDark ? 40 : 80)),
      '--ll-primary-container': mcu.hexFromArgb(s.primaryContainer),
      '--ll-on-primary-container': mcu.hexFromArgb(s.onPrimaryContainer),
      '--ll-popup-bg': isDark ? sc(st.high) : sc(st.highest),
      '--ll-veil-white-rgb': rgbTriplet(sc(98)),
      '--ll-veil-black-rgb': '0, 0, 0',
      '--ll-halo-rgb': rgbTriplet(sc(98)),
      '--ll-shadow-rgb': isDark ? '0, 0, 0' : rgbTriplet(sc(10)),
      '--ll-danger': mcu.hexFromArgb(s.error),
      '--ll-danger-rgb': rgbTriplet(mcu.hexFromArgb(s.error)),
      '--ll-danger-bg': mcu.hexFromArgb(s.errorContainer),
      '--ll-on-danger': mcu.hexFromArgb(s.onError),
      '--ll-inverse-surface': mcu.hexFromArgb(s.inverseSurface),
      '--ll-inverse-on-surface': mcu.hexFromArgb(s.inverseOnSurface),
      '--ll-success': mcu.hexFromArgb(s.tertiary),
      '--ll-warn': mcu.hexFromArgb(isDark ? s.tertiaryContainer : s.tertiary)
    };
  }
  let paletteGeneration = 0;
  async function applyDynamicPalette() {
    if (window.__liuliPaletteApplied) return;
    window.__liuliPaletteApplied = true;
    const generation = ++paletteGeneration;
    const paletteSettings = llNormalizeSettings(llModeCfg);
    let source = DEFAULT_SOURCE;
    try {
      source = paletteSettings.colorSource === 'custom'
        ? paletteSettings.customColor
        : await extractSource();
    } catch (e) {
      source = DEFAULT_SOURCE;
    }
    if (generation !== paletteGeneration) return;
    const mcu = window.LiuliMCU;
    const isDark = llIsDark();
    const roles = loadRoles();
    const theme = mcu.themeFromSourceColor(mcu.argbFromHex(source));
    const vars = deriveVars(mcu, theme, isDark, roles);
    try {
      Object.assign(vars, roleVars(mcu, theme, isDark, roles));
    } catch (e) {}
    const body = document.body;
    // 选中行会重定义 --ll-on-glass，先保留表面文字色，供低浓度选中态使用。
    vars['--ll-selection-glass-fg'] = vars['--ll-on-glass'];
    vars['--ll-selection-glass-fg-rgb'] = vars['--ll-on-glass-rgb'];
    for (const k in vars) {
      if (vars[k] === null) body.style.removeProperty(k);
      else body.style.setProperty(k, vars[k]);
    }
    body.dataset.liuliSource = source;
    body.dataset.liuliColorSource = paletteSettings.colorSource;
    body.toggleAttribute('data-liuli-other-solid', vars['--ll-bubble-other'] != null);
    syncSelectionContrast();
    llApplyModeSettings();
    refreshPaletteInfo();
    console.log(
      '[theme] ' + paletteSettings.colorSource + ' source = ' + source + ' (accent ' + vars['--ll-brand'] + ')'
    );
  }
  const GLASS = [
    ['.container-sidebar', 'var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))'],
    ['.recent-contact', 'var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))'],
    ['.right-sidebar', 'var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))'],
    ['.group-box', 'var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))'],
    [
      '.user-profile-card:not(.topbar-profile)',
      'var(--ll-noise), rgba(var(--ll-acrylic), var(--ll-material-opacity))'
    ]
  ];
  const CLEAR = [
    '.message-panel',
    '.container-content-view',
    '.two-col-layout',
    '.two-col-layout__aside',
    '.two-col-layout__main',
    '.aio',
    '.group-chat',
    '.chat-msg-area',
    '.sidebar-nav',
    '.sidebar-wrapper',
    '.group-panel',
    '.group-box__container',
    '.group-box__wrapper',
    '.group-notice',
    '.group-member',
    '.group-user',
    '.group-member-list'
  ];
  const QQ_COLOR_MAP = {
    'rgba(255, 255, 255, 0.9)': 'var(--ll-on-glass)',
    'rgba(255, 255, 255, 0.8)': 'var(--ll-on-glass)',
    'rgba(255, 255, 255, 0.7)': 'var(--ll-on-glass-2)',
    'rgba(255, 255, 255, 0.6)': 'var(--ll-on-glass-2)',
    'rgba(255, 255, 255, 0.5)': 'var(--ll-on-glass-3)',
    'rgba(255, 255, 255, 0.4)': 'var(--ll-on-glass-3)',
    'rgba(255, 255, 255, 0.3)': 'var(--ll-on-glass-3)',
    'rgb(128, 128, 128)': 'var(--ll-on-glass-2)',
    'rgb(102, 102, 102)': 'var(--ll-on-glass-2)',
    'rgb(153, 153, 153)': 'var(--ll-on-glass-2)',
    'rgb(204, 204, 204)': 'var(--ll-on-glass-3)',
    'rgb(0, 102, 204)': 'var(--ll-brand)',
    'rgb(45, 119, 229)': 'var(--ll-brand)',
    'rgb(0, 153, 255)': 'var(--ll-brand)',
    'rgb(247, 76, 48)': 'var(--ll-danger)',
    'rgb(255, 51, 82)': 'var(--ll-danger)',
    'rgb(21, 209, 115)': 'var(--ll-success)',
    'rgb(255, 179, 0)': 'var(--ll-warn)'
  };
  function elementsWithin(root, selector) {
    const nodes = [...root.querySelectorAll(selector)];
    if (root.matches && root.matches(selector)) nodes.unshift(root);
    return nodes;
  }
  function topLevelRoots(elements) {
    const roots = new Set(elements.filter(element => element.isConnected));
    return [...roots].filter(element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (roots.has(parent)) return false;
      }
      return true;
    });
  }
  function normalizeColors(root = document.body) {
    messageColorRepair().repair([root]);
  }
  const DIM_COLORS = new Set(['rgb(128, 128, 128)', 'rgb(102, 102, 102)', 'rgb(153, 153, 153)']);
  const TEXT_SELECTORS = [
    '.text-ellipsis',
    '.secondary-info',
    '.group-user__name',
    '.group-member-name',
    '.group-member .user-name',
    '.recent-contact-item .text-ellipsis',
    '.contact-name',
    '.summary-main'
  ];
  function fixContrast(root = document.body) {
    messageColorRepair().repair([root]);
  }
  let llColorRepair = null;
  function messageColorRepair() {
    return llColorRepair || (llColorRepair = createMessageColorRepair());
  }
  function createMessageColorRepair(options = {}) {
    const pending = new Set(), owned = new Map();
    let cache = new WeakMap(), timer = 0, frame = 0, quietUntil = 0, holding = 0, disposed = false;
    const selector = TEXT_SELECTORS.join(',');
    const scope = '.chat-msg-area,.recent-contact';
    const deferred = 'liuli-color-deferred';
    const stats = { reads: 0, writes: 0, flushes: 0 };
    function candidates(roots) {
      const result = new Set();
      for (const root of roots) if (root?.isConnected) {
        for (const element of elementsWithin(root, '*')) {
          if (element.matches('style,script') || element.closest('#liuli-scroll-time')) continue;
          if ((!element.children.length && element.textContent.trim()) || element.matches(selector)) result.add(element);
        }
      }
      return result;
    }
    function stateOf(element) {
      let state = owned.get(element);
      if (!state) {
        state = { color: element.style.getPropertyValue('color'), priority: element.style.getPropertyPriority('color'),
          applied: null, attributes: new Map() };
        owned.set(element, state);
      }
      return state;
    }
    function mark(element, name, value) {
      const state = stateOf(element);
      if (!state.attributes.has(name)) state.attributes.set(name, { before: element.getAttribute(name), applied: value });
      else state.attributes.get(name).applied = value;
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
    function releaseColor(element, state) {
      if (!state.applied) return;
      const current = element.style.getPropertyValue('color'), priority = element.style.getPropertyPriority('color');
      if (current === state.applied && priority === 'important') {
        if (state.color) element.style.setProperty('color', state.color, state.priority);
        else element.style.removeProperty('color');
      } else { state.color = current; state.priority = priority; }
      state.applied = null;
    }
    function restoreOwned(element, state) {
      releaseColor(element, state);
      for (const [name, value] of state.attributes) if (element.getAttribute(name) === value.applied) {
        if (value.before === null) element.removeAttribute(name);
        else element.setAttribute(name, value.before);
      }
    }
    function signature(element) {
      const nativeClass = (element.getAttribute('class') || '').split(/\s+/).filter(name => !/^(?:ll-|liuli-)/.test(name)).join(' ');
      return element.style.cssText + '\0' + nativeClass + '\0' + element.textContent + '\0' + (element.closest('.ml-item')?.id || '');
    }
    function clearScheduled() {
      clearTimeout(timer); timer = 0;
      cancelAnimationFrame(frame); frame = 0;
    }
    function schedule() {
      if (disposed || holding || !pending.size || document.hidden) return;
      clearScheduled();
      const wait = quietUntil - performance.now();
      if (wait > 0) timer = setTimeout(() => { timer = 0; flush(); }, wait);
      else frame = requestAnimationFrame(() => { frame = 0; flush(); });
    }
    function flush(force = false) {
      if (disposed || holding || document.hidden) return;
      clearScheduled();
      const writes = [], later = performance.now() < quietUntil;
      for (const [element, state] of owned) if (!element.isConnected) { restoreOwned(element, state); owned.delete(element); }
      // All computed colors are read before the first inline color write.
      for (const element of pending) {
        if (!element.isConnected) { pending.delete(element); owned.delete(element); continue; }
        if (!force && later && element.closest(scope)) continue;
        pending.delete(element);
        const key = signature(element);
        if (cache.get(element) === key) continue;
        if (/var\(\s*--ll-/.test(element.style.getPropertyValue('color'))) { cache.set(element, key); continue; }
        const color = getComputedStyle(element).color.replace(/\s+/g, ' ').trim();
        stats.reads++;
        const normalize = !element.children.length && !!element.textContent.trim();
        const contrast = element.matches(selector) && DIM_COLORS.has(color);
        const mapped = contrast ? 'var(--ll-on-glass-2)' : normalize ? QQ_COLOR_MAP[color] : null;
        if (mapped) writes.push({ element, mapped, normalize, contrast });
        else cache.set(element, key);
      }
      for (const { element, mapped, normalize, contrast } of writes) {
        const state = stateOf(element);
        element.style.setProperty('color', mapped, 'important'); state.applied = mapped;
        if (normalize) mark(element, 'data-liuli-color', '1');
        if (contrast) mark(element, 'data-liuli-fg', '1');
        cache.set(element, signature(element)); stats.writes++;
      }
      stats.flushes++;
      options.afterWrite?.();
      if (pending.size) schedule();
    }
    function enqueue(roots, asynchronous) {
      if (disposed) return;
      for (const element of candidates(roots)) {
        pending.add(element);
        if (options.legacyGate) {
          if (!element.getAttribute('data-liuli-color')) mark(element, 'data-liuli-color', deferred);
          if (!element.getAttribute('data-liuli-fg')) mark(element, 'data-liuli-fg', deferred);
        }
      }
      options.afterWrite?.();
      if (!holding) { if (asynchronous) schedule(); else flush(); }
    }
    function invalidate(root, subtree = true) {
      if (!root?.querySelectorAll) return;
      for (const element of subtree ? elementsWithin(root, '*') : [root]) {
        const state = owned.get(element);
        if (cache.has(element) || state || ((!element.children.length && element.textContent.trim()) || element.matches(selector))) pending.add(element);
        cache.delete(element);
        if (state) releaseColor(element, state);
      }
    }
    function activity(event) {
      if (!event.target?.closest?.(scope)) return;
      quietUntil = performance.now() + 180;
      if (pending.size) schedule();
    }
    function visibility() { if (document.hidden) clearScheduled(); else schedule(); }
    for (const name of ['wheel', 'touchmove', 'scroll']) document.addEventListener(name, activity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    const api = {
      repair(roots) { enqueue(roots, false); }, enqueue(roots) { enqueue(roots, true); }, invalidate, flush,
      batch(callback, force = false) { holding++; try { callback(); } finally { holding--; if (!holding) flush(force); } },
      get stats() { return { ...stats, pending: pending.size }; },
      dispose() {
        if (disposed) return;
        disposed = true; clearScheduled(); pending.clear(); cache = new WeakMap();
        for (const name of ['wheel', 'touchmove', 'scroll']) document.removeEventListener(name, activity, true);
        document.removeEventListener('visibilitychange', visibility);
        for (const [element, state] of owned) restoreOwned(element, state);
        owned.clear(); options.afterWrite?.();
      }
    };
    return api;
  }
  function applyOverrides(root = document.body) {
    try {
      for (const [sel, bg] of GLASS) {
        elementsWithin(root, sel).forEach(el => {
          if (el.dataset.liuliGlass) return;
          el.dataset.liuliGlass = '1';
          el.style.setProperty('background', bg, 'important');
          el.style.setProperty('backdrop-filter', 'var(--ll-material-blur)', 'important');
          el.style.setProperty('-webkit-backdrop-filter', 'var(--ll-material-blur)', 'important');
          el.style.setProperty('border-radius', 'var(--ll-radius)', 'important');
        });
      }
      for (const sel of CLEAR) {
        elementsWithin(root, sel).forEach(el => {
          if (el.dataset.liuliClear) return;
          el.dataset.liuliClear = '1';
          el.style.setProperty('background', 'transparent', 'important');
          el.style.setProperty('backdrop-filter', 'none', 'important');
          el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        });
      }
    } catch (e) {}
  }
  async function loadText(name) {
    const asset = await window.LiuliHost.readAsset(name);
    if (!asset.fetchOk) throw new Error('Missing theme asset: ' + name);
    return asset.text;
  }
  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }
  const DEFAULT_SETTINGS = {
    blur: 18,
    opacity: 0.5,
    glow: 0.15,
    shadow: 0.6,
    dimLight: 0.18,
    dimDark: 0.18,
    veilLight: 'light',
    veilDark: 'dark',
    // 置顶会话分组（#55）
    pinGroup: true,
    pinColor: false,
    pinCollapsed: false,
    hideImageNames: false,
    hideEmptyLogo: true,
    chatStyle: 'tg',
    avatarPosition: 'bottom',
    timSenderPosition: 'outside',
    messageFontSize: 14,
    nameFontSize: 12,
    titleFontSize: 10,
    bubbleScale: 100,
    bubbleMaxWidth: 100,
    selectedStrength: 100,
    colorSource: 'wallpaper',
    customColor: DEFAULT_SOURCE,
    showMessageTitles: true,
    showMessageIdentity: true,
    truncateMessageNames: true
  };
  const DIM_MAX = 0.8;
  const DIM_FALLBACK = 0.18;
  function llNormalizeSettings(raw) {
    const cfg = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    cfg.chatStyle = ['tg', 'classic', 'tim'].includes(cfg.chatStyle) ? cfg.chatStyle : 'tg';
    cfg.avatarPosition = cfg.avatarPosition === 'top' ? 'top' : 'bottom';
    cfg.timSenderPosition = cfg.timSenderPosition === 'inside' ? 'inside' : 'outside';
    cfg.colorSource = cfg.colorSource === 'custom' ? 'custom' : 'wallpaper';
    cfg.customColor = llNormalizeColorSeed(cfg.customColor) || DEFAULT_SOURCE;
    for (const key of ['showMessageTitles', 'showMessageIdentity', 'truncateMessageNames']) {
      cfg[key] = cfg[key] !== false;
    }
    for (const [key, min, max] of [['messageFontSize', 12, 24], ['nameFontSize', 10, 18], ['titleFontSize', 9, 14], ['bubbleScale', 80, 140], ['bubbleMaxWidth', 40, 100], ['selectedStrength', 15, 100]]) {
      const n = Number(cfg[key]);
      cfg[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_SETTINGS[key];
    }
    cfg.nameFontSize = Math.min(cfg.nameFontSize, cfg.messageFontSize);
    cfg.titleFontSize = Math.min(cfg.titleFontSize, cfg.nameFontSize);
    return cfg;
  }
  async function loadSettings() {
    try {
      return llNormalizeSettings(JSON.parse(localStorage.getItem(LL_STORAGE_KEY) || '{}'));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(cfg) {
    try {
      localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(cfg));
    } catch (error) {
      toast('保存失败：' + error.message);
    }
  }
  /* 置顶会话分组（#55）：DOM 标记全部交给 renderer/pin-groups.js，
   * 这里只做三件事——把设置翻译成 options、在设置变化时重新调用、
   * 把「点了小标题」写回 pinCollapsed。
   * 只在主窗口生效：设置窗（#/setting）和独立聊天窗里没有会话列表，
   * 挂监听没有意义，还会和主窗口抢同一个 .recent-contact。 */
  function llApplyPinGroups() {
    const api = window.__liuliPinGroups;
    if (!api || !document.body) return;
    try {
      if (document.body.dataset.liuliScope !== 'main') {
        api.clear();
        return;
      }
      const cfg = llNormalizeSettings(llModeCfg || {});
      api.apply({
        group: cfg.pinGroup !== false,
        color: cfg.pinColor === true,
        collapsed: cfg.pinCollapsed === true,
        onToggleCollapsed: next => llSetPinCollapsed(next)
      });
    } catch (e) {}
  }
  function llSetPinCollapsed(next) {
    const cfg = llNormalizeSettings(llModeCfg || {});
    cfg.pinCollapsed = !!next;
    // 走 applySettings 而不是直接 saveSettings：它会同步 llModeCfg、
    // 写 localStorage（广播给设置窗）并重新 apply，一处收口。
    applySettings(cfg, true);
  }
  async function llResetAll() {
    try {
      if (window.LiuliVideoWallpaper) await window.LiuliVideoWallpaper.clearAll();
      for (const key of Object.keys(localStorage)) {
        if (/^liuli[-_]/i.test(key)) localStorage.removeItem(key);
      }
      return true;
    } catch (error) {
      console.warn('[theme] reset failed', error);
      return false;
    }
  }
  const LL_STORAGE_KEY = 'liuli-dsh-settings';
  let llSuppressBroadcast = false;
  let llModeCfg = Object.assign({}, DEFAULT_SETTINGS);
  // 打开的面板持有同一份配置；跨窗口修改时原位更新，避免旧面板把新值覆盖回去。
  const llPanelSettings = new Set();
  let llSettingsApplied = false;
  function llDimFor(cfg, dark) {
    const v = dark ? cfg.dimDark : cfg.dimLight;
    const n = Number(v);
    return isFinite(n) && v !== null && v !== undefined ? n : DIM_FALLBACK;
  }
  function llVeilFor(cfg, dark) {
    return (dark ? cfg.veilDark : cfg.veilLight) === 'light' ? 'light' : 'dark';
  }
  const LL_VEIL_RGB = {
    light: 'var(--ll-veil-white-rgb, 255, 255, 255)',
    dark: 'var(--ll-veil-black-rgb, 0, 0, 0)'
  };
  function llApplyModeSettings() {
    const b = document.body;
    const cfg = llModeCfg || DEFAULT_SETTINGS;
    const dark = llIsDark();
    const shadow = Number(cfg.shadow);
    const s = isFinite(shadow) ? shadow : DEFAULT_SETTINGS.shadow;
    const k = dark ? 1 : 0.6;
    b.style.setProperty('--ll-wallpaper-dim', String(llDimFor(cfg, dark)));
    b.style.setProperty('--ll-veil-rgb', LL_VEIL_RGB[llVeilFor(cfg, dark)]);
    b.style.setProperty(
      '--ll-shadow',
      '0 2px 10px rgba(var(--ll-shadow-rgb), ' + (s * 0.4 * k).toFixed(2) + ')'
    );
    b.style.setProperty(
      '--ll-shadow-float',
      '0 8px 28px rgba(var(--ll-shadow-rgb), ' + (s * 0.47 * k).toFixed(2) + ')'
    );
  }
  function syncSelectionContrast() {
    const body = document.body;
    const style = getComputedStyle(body);
    const parse = text => {
      const value = String(text || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        const n = parseInt(value.slice(1), 16);
        return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      }
      const parts = value.match(/[\d.]+/g);
      return parts && parts.length >= 3 ? parts.slice(0, 3).map(Number) : null;
    };
    const selected = parse(style.getPropertyValue('--ll-selected-rgb') || style.getPropertyValue('--ll-brand-rgb'));
    const surface = parse(style.getPropertyValue('--ll-acrylic'));
    const solidInk = parse(style.getPropertyValue('--ll-on-selected') || style.getPropertyValue('--ll-on-brand'));
    const glassInk = parse(style.getPropertyValue('--ll-selection-glass-fg') || style.getPropertyValue('--ll-on-glass'));
    if (!selected || !surface || !solidInk || !glassInk) return;
    const alpha = llModeCfg.selectedStrength / 100;
    const background = selected.map((v, i) => v * alpha + surface[i] * (1 - alpha));
    const luminance = rgb => rgb.map(v => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bg = luminance(background);
    const contrast = rgb => {
      const fg = luminance(rgb);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    };
    // 以侧栏材质色估计合成底色；中间浓度下两个主题色都可能对比不足，
    // 这时采用黑/白兜底，不把文字跟着背景一起减淡。
    let ink = contrast(glassInk) > contrast(solidInk) ? glassInk : solidInk;
    if (contrast(ink) < 4.5) {
      const black = [0, 0, 0], white = [255, 255, 255];
      ink = contrast(black) > contrast(white) ? black : white;
    }
    body.style.setProperty('--ll-selection-readable-fg', 'rgb(' + ink.join(',') + ')');
    body.style.setProperty('--ll-selection-readable-fg-rgb', ink.join(','));
    // 辅助文字逐步混入选中色以区分层级，但不能因此跌破小字对比阈值。
    const supportingInk = preferred => {
      for (let weight = preferred; weight <= 1.001; weight += 0.02) {
        const candidate = ink.map((v, i) => Math.round(v * Math.min(weight, 1) + selected[i] * (1 - Math.min(weight, 1))));
        if (contrast(candidate) >= 4.5) return 'rgb(' + candidate.join(',') + ')';
      }
      return 'rgb(' + ink.join(',') + ')';
    };
    body.style.setProperty('--ll-selection-summary-fg', supportingInk(0.84));
    body.style.setProperty('--ll-selection-meta-fg', supportingInk(0.76));
    // 徽标是独立的实色小胶囊，不能跟着低浓度行的文字反色一起改变配对。
    body.style.setProperty('--ll-selection-badge-bg', 'rgb(' + selected.join(',') + ')');
    body.style.setProperty('--ll-selection-badge-fg', 'rgb(' + solidInk.join(',') + ')');
    body.toggleAttribute('data-liuli-soft-selection', ink.some((v, i) => v !== solidInk[i]));
  }

  function syncBubbleWidth() {
    const ratio = llModeCfg.bubbleMaxWidth / 100;
    document.body.toggleAttribute('data-liuli-limit-bubbles', ratio < 1);
    // QQ 会保留隐藏的旧聊天区，不能拿第一个区域的宽度写成全窗口共用值。
    for (const area of document.querySelectorAll('.chat-msg-area')) {
      if (ratio >= 1) {
        area.style.removeProperty('--ll-message-max-width');
        continue;
      }
      if (area.clientWidth < 1) continue;
      const value = Math.max(1, Math.floor(area.clientWidth * ratio)) + 'px';
      if (area.style.getPropertyValue('--ll-message-max-width') !== value) {
        area.style.setProperty('--ll-message-max-width', value);
      }
      // 原生图片节点用内联固定宽高，缩窄时媒体盒也必须等比缩放。
      syncPictureRatios(area);
    }
  }

  function syncPictureRatios(root) {
    if (llModeCfg.bubbleMaxWidth >= 100) return;
    const pictures = [...root.querySelectorAll('.pic-element, .market-face-element')];
    if (root.matches?.('.pic-element, .market-face-element')) pictures.unshift(root);
    for (const picture of pictures) {
      const width = parseFloat(picture.style.width);
      const height = parseFloat(picture.style.height);
      if (width > 0 && height > 0) {
        const ratio = String(width / height);
        if (picture.style.getPropertyValue('--ll-picture-ratio') !== ratio)
          picture.style.setProperty('--ll-picture-ratio', ratio);
      }
    }
  }

  function applySettings(cfg, broadcast) {
    const b = document.body;
    const previous = llModeCfg;
    llModeCfg = llNormalizeSettings(cfg);
    const paletteChanged = previous.colorSource !== llModeCfg.colorSource ||
      previous.customColor !== llModeCfg.customColor;
    const reflowMessages = !llSettingsApplied || ['chatStyle', 'avatarPosition', 'timSenderPosition', 'hideImageNames']
      .some(key => previous[key] !== llModeCfg[key]);
    llSettingsApplied = true;
    window.__liuliSettingsCache = llModeCfg;
    for (const panelSettings of llPanelSettings) Object.assign(panelSettings, llModeCfg);
    b.style.setProperty('--ll-material-blur', 'blur(' + llModeCfg.blur + 'px) saturate(1.6)');
    b.style.setProperty('--ll-material-opacity', String(llModeCfg.opacity));
    b.style.setProperty('--ll-glow-strength', String(llModeCfg.glow));
    b.toggleAttribute('data-liuli-hide-image-names', llModeCfg.hideImageNames === true);
    b.toggleAttribute('data-liuli-hide-empty-logo', llModeCfg.hideEmptyLogo !== false);
    b.toggleAttribute('data-liuli-hide-message-titles', !llModeCfg.showMessageTitles);
    b.toggleAttribute('data-liuli-hide-message-identity', !llModeCfg.showMessageIdentity);
    b.toggleAttribute('data-liuli-full-message-names', !llModeCfg.truncateMessageNames);
    b.dataset.liuliChatStyle = llModeCfg.chatStyle;
    b.dataset.liuliAvatarPosition = llModeCfg.avatarPosition;
    b.dataset.liuliTimSenderPosition = llModeCfg.timSenderPosition;
    b.style.setProperty('--ll-message-font-size', llModeCfg.messageFontSize + 'px');
    b.style.setProperty('--ll-name-font-size', llModeCfg.nameFontSize + 'px');
    b.style.setProperty('--ll-title-font-size', llModeCfg.titleFontSize + 'px');
    b.style.setProperty('--ll-bubble-scale', String(llModeCfg.bubbleScale / 100));
    b.toggleAttribute('data-liuli-scaled-bubbles', llModeCfg.bubbleScale !== 100);
    b.style.setProperty('--ll-selected-strength', String(llModeCfg.selectedStrength / 100));
    syncSelectionContrast();
    llApplyModeSettings();
    syncBubbleWidth();
    window.__liuliVoiceLayout?.refresh();
    if (reflowMessages) {
      moveSenderIntoBubble(document);
      groupMessages();
      scheduleStick();
    }
    if (broadcast !== false && !llSuppressBroadcast) {
      try {
        localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(llModeCfg));
      } catch (e) {}
    }
    llApplyPinGroups();
    // 只刷新显示，不触发 input/change，避免收到跨窗口更新后再次广播旧配置。
    for (const control of document.querySelectorAll('[data-liuli-setting]')) {
      const value = llModeCfg[control.dataset.liuliSetting];
      if (control.matches('input[type="range"]')) {
        control.value = value;
        const ratio = (Number(value) - Number(control.min)) / (Number(control.max) - Number(control.min));
        control.style.setProperty('--liuli-pct', Math.max(0, Math.min(100, ratio * 100)) + '%');
        const output = control.parentElement.querySelector('.liuli-field__value');
        if (output) output.textContent = value + (control.dataset.unit || 'px');
      } else {
        for (const button of control.querySelectorAll('button[data-setting-value]')) {
          button.classList.toggle('is-active', button.dataset.settingValue === String(value));
        }
      }
    }
    llSyncSettingDependencies();
    llSyncColorSourceControls();
    if (paletteChanged) {
      // A new generation also invalidates an older, still decoding wallpaper.
      window.__liuliPaletteApplied = false;
      applyDynamicPalette().catch(error => console.warn('[theme] palette failed:', error));
    }
  }
  function llSyncSettingDependencies() {
    for (const [key, enabled, reason] of [
      ['avatarPosition', ['tg', 'tim'].includes(llModeCfg.chatStyle), '仅 TG 和 TIM 气泡使用此设置，已保存的头像位置会保留。'],
      ['timSenderPosition', llModeCfg.chatStyle === 'tim', '仅 TIM 气泡使用此设置，已保存的名称与标签位置会保留。'],
      ['pinColor', llModeCfg.pinGroup !== false, '先开启「置顶会话单独成组」，已保存的颜色选项会保留。']
    ]) {
      for (const row of document.querySelectorAll('[data-liuli-setting="' + key + '"]')) {
        row.classList.toggle('is-dependent-disabled', !enabled);
        row.hidden = false;
        row.setAttribute('aria-disabled', String(!enabled));
        row.title = enabled ? '' : reason;
        for (const button of row.querySelectorAll('button')) button.disabled = !enabled;
      }
    }
  }
  function llSyncColorSourceControls() {
    for (const row of document.querySelectorAll('[data-liuli-setting="colorSource"]')) {
      for (const button of row.querySelectorAll('button[data-setting-value]')) {
        button.setAttribute('aria-pressed', String(button.dataset.settingValue === llModeCfg.colorSource));
      }
    }
    for (const custom of document.querySelectorAll('[data-liuli-color-custom]')) {
      custom.hidden = llModeCfg.colorSource !== 'custom';
      custom.style.setProperty('--liuli-color-seed', llModeCfg.customColor);
      custom.__liuliColorWheel?.setSeed(llModeCfg.customColor);
      const picker = custom.querySelector('input[type="color"]');
      const hex = custom.querySelector('input[type="text"]');
      if (picker) picker.value = llModeCfg.customColor;
      if (hex) {
        hex.value = llModeCfg.customColor;
        hex.setCustomValidity('');
        hex.setAttribute('aria-invalid', 'false');
      }
      const error = custom.querySelector('[data-liuli-color-error]');
      if (error) error.textContent = '';
    }
  }
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== LL_STORAGE_KEY || !e.newValue) return;
      try {
        const incoming = llNormalizeSettings(JSON.parse(e.newValue));
        llSuppressBroadcast = true;
        applySettings(incoming, false);
        const sliders = document.querySelectorAll('.liuli-slider:not([data-liuli-setting])');
        if (sliders.length === FIELDS.length) {
          FIELDS.forEach(function (f, i) {
            const el = sliders[i];
            if (el && Number(el.value) !== Number(incoming[f.key])) {
              el.value = incoming[f.key];
              el.dispatchEvent(new Event('input'));
            }
          });
        }
        llRefreshVeilSegs(incoming);
      } catch (err) {
      } finally {
        llSuppressBroadcast = false;
      }
    });
  } catch (e) {}
  let llVeilSegRefreshers = [];
  function llRefreshVeilSegs(cfg) {
    const c = cfg || llModeCfg;
    for (const fn of llVeilSegRefreshers) {
      try {
        fn(c);
      } catch (e) {}
    }
  }
  const FIELDS = [
    {
      key: 'blur',
      label: '材质模糊',
      min: 0,
      max: 40,
      step: 1,
      unit: 'px',
      hint: '玻璃层的 backdrop-filter 半径'
    },
    {
      key: 'opacity',
      label: '不透明度',
      min: 0.1,
      max: 0.9,
      step: 0.01,
      unit: '',
      hint: '玻璃底有多实。过低会影响可读性',
      pct: v => ((v - 0.1) / 0.8) * 100
    },
    {
      key: 'glow',
      label: '泛光强度',
      min: 0,
      max: 1,
      step: 0.01,
      unit: '',
      hint: '主题色在边缘的发光量',
      pct: v => v * 100
    },
    {
      key: 'shadow',
      label: '阴影强度',
      min: 0,
      max: 1,
      step: 0.01,
      unit: '',
      hint: '玻璃卡片的投影浓度',
      pct: v => v * 100
    },
    {
      key: 'dimLight',
      veilKey: 'veilLight',
      label: '亮色主题遮罩',
      min: 0,
      max: DIM_MAX,
      step: 0.01,
      unit: '',
      hint: '亮色主题下盖在壁纸上的遮罩。过低会影响可读性',
      pct: v => (v / DIM_MAX) * 100
    },
    {
      key: 'dimDark',
      veilKey: 'veilDark',
      label: '暗色主题遮罩',
      min: 0,
      max: DIM_MAX,
      step: 0.01,
      unit: '',
      hint: '暗色主题下盖在壁纸上的遮罩。过低会影响可读性',
      pct: v => (v / DIM_MAX) * 100
    }
  ];
  function toast(text) {
    let el = document.getElementById('liuli-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'liuli-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1600);
  }
  function keepWindowControlsVisible() {
    try {
      const wc = document.querySelector('.window-control-area');
      if (!wc) return;
      ['opacity', 'pointer-events', 'transform'].forEach(function (k) {
        if (wc.style.getPropertyPriority(k) === 'important') wc.style.removeProperty(k);
      });
    } catch (e) {}
  }
  const ICON_EMOJI =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle>' +
    '<path d="M8 14s1.5 2 4 2 4-2 4-2"></path>' +
    '<line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>';
  const ICON_PLUS =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line>' +
    '<line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  function buildInputOverlay() {
    var overlay = document.getElementById('liuli-input-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'liuli-input-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'z-index:9999',
      'display:none',
      'align-items:center',
      'gap:4px',
      'pointer-events:none'
    ].join(';');
    var pins = document.createElement('div');
    pins.id = 'liuli-bar-pins';
    pins.style.cssText = 'display:flex;align-items:center;gap:4px';
    var emoji = pins;
    var more = document.createElement('button');
    more.id = 'liuli-func-toggle';
    more.type = 'button';
    more.title = '更多';
    more.setAttribute('aria-label', '更多');
    more.innerHTML = ICON_PLUS;
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      setExpanded(true);
    });
    overlay.appendChild(more);
    overlay.appendChild(pins);
    document.body.appendChild(overlay);
    var hoverTimer = 0;
    function setExpanded(open) {
      if (document.body.dataset.liuliInputLayout === 'native') open = false;
      var bar = document.querySelector('.chat-func-bar');
      if (!bar) return;
      more.dataset.open = open ? '1' : '0';
      more.title = open ? '收起' : '更多';
      if (open) {
        llLabelFuncBar(bar);
        applyBar();
      }
      if (bar.classList.contains('liuli-expanded') === open) return;
      bar.classList.toggle('liuli-expanded', open);
      var area = document.querySelector('.chat-input-area');
      if (area) {
        if (open) area.style.setProperty('z-index', '40', 'important');
        else area.style.removeProperty('z-index');
      }
    }
    function isHoverZone(t) {
      if (!t || !t.closest) return false;
      return !!(t.closest('#liuli-func-toggle') || t.closest('.chat-func-bar.liuli-expanded'));
    }
    document.addEventListener(
      'mouseover',
      function (e) {
        if (isHoverZone(e.target)) {
          clearTimeout(hoverTimer);
          if (e.target.closest('#liuli-func-toggle')) setExpanded(true);
        }
      },
      true
    );
    document.addEventListener(
      'mouseout',
      function (e) {
        if (!isHoverZone(e.target)) return;
        if (isHoverZone(e.relatedTarget)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () {
          setExpanded(false);
        }, 250);
      },
      true
    );
    document.addEventListener(
      'mousedown',
      function (e) {
        var bar = document.querySelector('.chat-func-bar');
        if (!bar || !bar.classList.contains('liuli-expanded')) return;
        if (bar.contains(e.target) || more.contains(e.target) || emoji.contains(e.target)) return;
        bar.classList.remove('liuli-expanded');
        more.dataset.open = '0';
        more.title = '更多';
        var area = document.querySelector('.chat-input-area');
        if (area) area.style.removeProperty('z-index');
      },
      true
    );
    return overlay;
  }
  function llLabelFuncBar(bar) {
    try {
      bar = bar || document.querySelector('.chat-func-bar');
      if (!bar) return;
      bar.querySelectorAll('.icon-item[aria-label]').forEach(function (it) {
        var t = (it.getAttribute('aria-label') || '')
          .replace(/\s*(Ctrl|Alt|Shift|⌘)[\s\S]*$/, '')
          .trim();
        if (it.dataset.liuliLabel !== t) it.dataset.liuliLabel = t;
      });
    } catch (e) {}
  }
  function mountInputBar() {
    try {
      /* #52：独立聊天窗（#/chat）也套主窗的 TG 单行输入条；
       * 迷你窗等其它非主窗口保留 QQ 原生输入区，不挂代理按钮。 */
      const mainLike =
        document.body.dataset.liuliScope === 'main' || (location.hash || '').indexOf('#/chat') === 0;
      if (!mainLike || document.body.dataset.liuliInputLayout === 'native') {
        const nativeOverlay = document.getElementById('liuli-input-overlay');
        if (nativeOverlay) nativeOverlay.style.display = 'none';
        return;
      }
      var overlay = buildInputOverlay();
      var area = document.querySelector('.chat-input-area');
      if (!area) {
        overlay.style.display = 'none';
        return;
      }
      var r = area.getBoundingClientRect();
      if (r.width < 100 || r.height < 20 || r.bottom < 0 || r.top > window.innerHeight) {
        overlay.style.display = 'none';
        return;
      }
      var box = area.querySelector('.msg-input');
      var br = box ? box.getBoundingClientRect() : r;
      var bar = document.querySelector('.chat-func-bar');
      var expanded = !!(bar && bar.classList.contains('liuli-expanded'));
      var moreBtn = overlay.querySelector('#liuli-func-toggle');
      var panel = document.querySelector('.expression-panel');
      var panelOpen = !!(panel && panel.getBoundingClientRect().height > 10);
      overlay.style.display = 'flex';
      overlay.style.left = Math.round(br.left + 6) + 'px';
      overlay.style.top = Math.round(br.bottom - 6 - 28) + 'px';
      if (moreBtn && moreBtn.dataset.open !== (expanded ? '1' : '0')) {
        moreBtn.dataset.open = expanded ? '1' : '0';
        moreBtn.title = expanded ? '收起' : '更多';
      }
      llSyncPins(overlay);
      var emojiBtn = overlay.querySelector('#liuli-emoji-btn');
      if (emojiBtn && emojiBtn.dataset.open !== (panelOpen ? '1' : '0')) {
        emojiBtn.dataset.open = panelOpen ? '1' : '0';
      }
    } catch (e) {}
  }
  function llSyncPins(overlay) {
    overlay = overlay || document.getElementById('liuli-input-overlay');
    var pins = overlay && overlay.querySelector('#liuli-bar-pins');
    if (!pins) return;
    var labels = applyBar();
    if (!labels.length && !document.querySelector('.chat-input-area .chat-func-bar')) return;
    if (document.querySelector('.chat-input-area .chat-func-bar .bar-icon')) {
      labels = labels.filter(function (label) {
        return !!nativeBarItem(label);
      });
    }
    var key = labels.join('\u0001');
    var complete = !pins.querySelector('[data-noicon]');
    if (pins.dataset.key === key && complete) return;
    pins.dataset.key = key;
    pins.innerHTML = '';
    labels.forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-bar-btn';
      if (label === '表情') b.id = 'liuli-emoji-btn';
      b.title = label;
      b.setAttribute('aria-label', label);
      var native = nativeBarItem(label);
      var svg = native && native.querySelector('svg');
      if (label === '表情') b.innerHTML = ICON_EMOJI;
      else if (svg) b.innerHTML = svg.outerHTML;
      else {
        b.innerHTML = ICON_PLUS;
        b.dataset.noicon = '1';
      }
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var n = nativeBarItem(label);
        if (n) n.click();
      });
      pins.appendChild(b);
    });
    document.body.style.setProperty('--liuli-bar-pad', 12 + (labels.length + 1) * 32 + 'px');
  }
  function isImageOnlyContent(content) {
    let images = 0;
    function visit(node) {
      if (node.nodeType === Node.COMMENT_NODE) return true;
      if (node.nodeType === Node.TEXT_NODE) return !node.textContent.trim();
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.classList.contains('pic-element')) {
        images++;
        return true;
      }
      // 只放行无语义的包装层，不靠附件黑名单猜测未知消息类型。
      if (!['DIV', 'SPAN'].includes(node.tagName) ||
          [...node.classList].some(name => !['message-content', 'mix-message__inner'].includes(name)) ||
          !node.childNodes.length) return false;
      return [...node.childNodes].every(visit);
    }
    return !!content && [...content.childNodes].every(visit) && images > 0;
  }
  function isVideoOnlyContent(content) {
    let videos = 0;
    function visit(node) {
      if (node.nodeType === Node.COMMENT_NODE) return true;
      if (node.nodeType === Node.TEXT_NODE) return !node.textContent.trim();
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.classList.contains('video-element') ||
          ['msg-preview', 'msg-preview--video', 'file-element'].every(name => node.classList.contains(name))) {
        videos++;
        return true;
      }
      if (!['DIV', 'SPAN'].includes(node.tagName) ||
          [...node.classList].some(name => !['message-content', 'mix-message__inner', 'message-content__wrapper', 'file-message--content'].includes(name)) ||
          !node.childNodes.length) return false;
      return [...node.childNodes].every(visit);
    }
    return !!content && [...content.childNodes].every(visit) && videos > 0;
  }
  function moveSenderIntoBubble(root) {
    try {
      var homes = moveSenderIntoBubble.homes || (moveSenderIntoBubble.homes = new WeakMap());
      var inside = llModeCfg.chatStyle === 'tg' ||
        (llModeCfg.chatStyle === 'tim' && llModeCfg.timSenderPosition === 'inside');
      var containers = elementsWithin(root, '.message-container');
      for (var i = 0; i < containers.length; i++) {
        var mc = containers[i];
        var bubble = mc.querySelector('.msg-content-container');
        // QQ also renders video files without a normal bubble/content pair.
        // Inspect the whole content wrapper so captions/replies stay mixed.
        var fileBubble = mc.querySelector('.file-message--content');
        var videoContent = bubble ? bubble.querySelector('.message-content') :
          mc.querySelector(':scope > .message-content__wrapper') || fileBubble;
        var videoOnly = isVideoOnlyContent(videoContent);
        mc.toggleAttribute('data-liuli-video-only', videoOnly);
        if (fileBubble) fileBubble.toggleAttribute('data-liuli-video-only', videoOnly);
        if (!bubble) {
          continue;
        }
        // #47：按正文结构识别纯图片，不能只认 QQ 偶尔才添加的 --pic 类。
        // 混合文字、引用或卡片消息仍保留昵称，避免隐藏发送者上下文。
        var content = bubble.querySelector('.message-content');
        var imageOnly = isImageOnlyContent(content);
        if (imageOnly !== bubble.hasAttribute('data-liuli-image-only')) {
          bubble.toggleAttribute('data-liuli-image-only', imageOnly);
        }
        mc.toggleAttribute('data-liuli-image-only', imageOnly);
        bubble.toggleAttribute('data-liuli-video-only', videoOnly);
        var name = mc.querySelector('.user-name');
        if (!name) continue;
        if (!inside) {
          // Return the same native node to its original grid position, including
          // its sibling order. A recycled row may no longer contain that home.
          var home = homes.get(name);
          if (home && mc.contains(home.parent)) {
            var next = home.next && home.next.parentNode === home.parent ? home.next : null;
            if (name.parentNode !== home.parent || name.nextSibling !== next) home.parent.insertBefore(name, next);
          } else if (name.parentElement !== mc) mc.appendChild(name);
          homes.delete(name);
          if (bubble.hasAttribute('data-liuli-named')) delete bubble.dataset.liuliNamed;
        } else {
          if (!bubble.contains(name)) {
            homes.set(name, { parent: name.parentNode, next: name.nextSibling });
            bubble.insertBefore(name, bubble.firstChild);
          }
          if (bubble.dataset.liuliNamed !== '1') bubble.dataset.liuliNamed = '1';
        }
      }
    } catch (e) {}
  }
  function groupMessages() {
    try {
      var list = document.querySelectorAll('.chat-msg-area .message-container');
      if (list.length === 0) return;
      var records = new WeakMap();
      var sequences = new Map();
      var visibleRecords = new Map();
      function recordOf(mc) {
        if (records.has(mc)) return records.get(mc);
        var record = null;
        try { record = window.LiuliQQ?.messageRecord(mc) || null; } catch (e) {}
        records.set(mc, record);
        return record;
      }
      function keyOf(mc) {
        var record = recordOf(mc);
        var sender = record && (record.senderUid || record.senderUin);
        if (sender) return [record.chatType, record.peerUid || record.peerUin, sender].join(':');
        var av = mc.querySelector(':scope > .avatar-span');
        var lbl = av && av.getAttribute('aria-label');
        if (lbl) return lbl;
        var nick = mc.querySelector('.user-name > .text-ellipsis');
        if (nick) {
          var t = (nick.textContent || '').trim();
          if (t) return t;
        }
        var img = mc.querySelector('[class*="avatar"] img');
        if (img && img.src) return img.src;
        return '';
      }
      function hiddenTimestampRow(row) {
        // Only a pure native time row may disappear from visual adjacency.
        // Never skip hidden system/revoke rows or virtual-list placeholders.
        if (!row.matches('.ml-item')) return false;
        var stamps = row.querySelectorAll('.message__timestamp');
        // scroll-time.css hides native timestamps. An explicit visible inline
        // override remains a boundary; normal grouping never forces a layout
        // just to reread our own stylesheet's display:none.
        if (stamps.length !== 1 || (stamps[0].style?.display && stamps[0].style.display !== 'none')) return false;
        function onlyTimestamp(node) {
          if (node === stamps[0] || node.nodeType === 8) return true;
          if (node.nodeType === 3) return !node.textContent.trim();
          return node.nodeType === 1 && (node === row || node.matches('.message')) &&
            node.childNodes.length > 0 && [...node.childNodes].every(onlyTimestamp);
        }
        return onlyTimestamp(row);
      }
      function adjacent(a, b) {
        if (!a || !b || a.closest('.chat-msg-area') !== b.closest('.chat-msg-area')) return false;
        var ra = recordOf(a), rb = recordOf(b);
        var ta = Number(ra && ra.msgTime), tb = Number(rb && rb.msgTime);
        // Time is presented by the top pill. A hidden native timestamp or
        // elapsed interval must not split otherwise consecutive sender rows.
        if (ta > 0 && tb > 0 && tb < ta) return false;
        var rowA = a.closest('.ml-item'), rowB = b.closest('.ml-item');
        if (rowA && rowB && rowA !== rowB) {
          var next = rowA.nextElementSibling;
          while (next && next !== rowB && hiddenTimestampRow(next)) next = next.nextElementSibling;
          if (next !== rowB) return false;
        }
        return true;
      }
      var keys = [];
      var groupable = [];
      var timTextRows = [];
      for (var i = 0; i < list.length; i++) {
        keys.push(keyOf(list[i]));
        // TIM connects text corners only. Native media/voice/card shapes stay
        // independent; avatar/sender groups are resolved separately below.
        var timText = false;
        if (llModeCfg.chatStyle === 'tim') {
          var bubble = list[i].querySelector('.msg-content-container');
          var content = bubble && bubble.querySelector(':scope > .message-content');
          // Native inline QQ faces can be direct children of message-content,
          // with no text-element or textContent. They share text-bubble shape;
          // a known face payload is required so empty/unknown content stays out.
          var hasText = content && [...content.querySelectorAll('.text-element')].some(text => text.textContent.trim());
          var hasInlineFace = content && content.querySelector('.face-element img.face-element__icon, .face-element img[data-role="qqFace"]');
          timText = content && (hasText || hasInlineFace) &&
            !bubble.matches('.container--personalization, .ptt-message__container, .mix-message__container--pic, .mix-message__container--image, .mix-message__container--market-face, .mix-message__container--lottie-face, .markdown-message__container--lottie-face, .ark-msg-content-container, [data-liuli-image-only], [data-liuli-video-only]') &&
            !content.querySelector('.ark-view-message, .forward-msg, .file-element, .pic-element, .market-face-element, .video-element, [class*="lottie"]');
        }
        // CSS consumes the same eligibility result instead of independently
        // guessing from .message-content, which QQ also uses for stickers.
        timTextRows.push(!!timText);
        groupable.push(llModeCfg.chatStyle === 'tg' || (llModeCfg.chatStyle === 'tim' && !!timText));
        var area = list[i].closest('.chat-msg-area');
        var record = recordOf(list[i]);
        if (!visibleRecords.has(area)) visibleRecords.set(area, new Map());
        if (record?.msgId != null) visibleRecords.get(area).set(String(record.msgId), i);
        if (!sequences.has(area) && ['tg', 'tim'].includes(llModeCfg.chatStyle)) {
          var sequence = null;
          try { sequence = window.LiuliQQ?.loadedMessageSequence?.(area) || null; } catch (e) {}
          sequences.set(area, sequence);
        }
      }
      function nativeBoundary(index, direction, shape) {
        var mc = list[index], area = mc.closest('.chat-msg-area');
        var sequence = sequences.get(area), current = recordOf(mc);
        if (!sequence || !current) return false;
        var row = mc.closest('.ml-item');
        if (!row) return false;
        var sibling = direction === 'previous' ? row.previousElementSibling : row.nextElementSibling;
        while (sibling && hiddenTimestampRow(sibling))
          sibling = direction === 'previous' ? sibling.previousElementSibling : sibling.nextElementSibling;
        // Native data only fills a virtual-window edge. Every mounted system,
        // revoke, unknown row or visible time divider remains authoritative.
        if (sibling) return false;
        var neighbors = sequence.neighbors(current);
        var other = neighbors && neighbors[direction];
        var peer = current.peerUid || current.peerUin, sender = current.senderUid || current.senderUin;
        if (!other || !peer || !sender || String(other.chatType) !== String(current.chatType) ||
          String(other.peerUid || other.peerUin) !== String(peer) ||
          String(other.senderUid || other.senderUin) !== String(sender)) return false;
        var before = direction === 'previous' ? other : current;
        var after = direction === 'previous' ? current : other;
        if (Number(before.msgTime) > 0 && Number(after.msgTime) > 0 && Number(after.msgTime) < Number(before.msgTime)) return false;
        var visible = visibleRecords.get(area)?.get(String(other.msgId));
        if (visible !== undefined) return !shape || groupable[visible];
        // Offscreen records have no DOM classification. Only positively known
        // ordinary text/inline faces extend an edge; system and unknown media
        // payloads must never be inferred from their sender or msgType alone.
        return Number(other.msgType) === 2 && Array.isArray(other.elements) && other.elements.length > 0 &&
          !(Number(other.recallTime) > 0) && other.elements.every(element =>
            (Number(element.elementType) === 1 && typeof element.textElement?.content === 'string' && element.textElement.content.trim()) ||
            (Number(element.elementType) === 6 && element.faceElement && typeof element.faceElement === 'object'));
      }
      var states = [];
      for (var j = 0; j < list.length; j++) {
        var mc = list[j];
        var key = keys[j];
        var avatarGroup = null;
        if (llModeCfg.chatStyle === 'tim') {
          // Avatar groups span native media as TG does; TIM text shapes remain
          // independent so images/files/voice never acquire connected corners.
          var prevAvatar = key && ((j > 0 && keys[j - 1] === key && adjacent(list[j - 1], mc)) || nativeBoundary(j, 'previous', false));
          var nextAvatar = key && ((j < list.length - 1 && keys[j + 1] === key && adjacent(mc, list[j + 1])) || nativeBoundary(j, 'next', false));
          avatarGroup = !key ? '' : prevAvatar ? (nextAvatar ? 'mid' : 'last') : (nextAvatar ? 'first' : 'single');
        }
        if (!key) {
          states.push({ row: mc, group: '', avatar: avatarGroup, timText: timTextRows[j] });
          continue;
        }
        var grouped = groupable[j];
        var prevSame = grouped && ((j > 0 && groupable[j - 1] && keys[j - 1] === key && adjacent(list[j - 1], mc)) || nativeBoundary(j, 'previous', true));
        var nextSame = grouped && ((j < list.length - 1 && groupable[j + 1] && keys[j + 1] === key && adjacent(mc, list[j + 1])) || nativeBoundary(j, 'next', true));
        var g;
        if (!prevSame && !nextSame) g = 'single';
        else if (!prevSame && nextSame) g = 'first';
        else if (prevSame && nextSame) g = 'mid';
        else g = 'last';
        states.push({ row: mc, group: g, avatar: avatarGroup, timText: timTextRows[j] });
      }
      // Resolve the complete native neighborhood before publishing any state.
      // Repeated passes over unchanged rows must not emit attribute mutations.
      for (var state of states) {
        var mc = state.row;
        if (mc.hasAttribute('data-liuli-tim-text') !== state.timText) mc.toggleAttribute('data-liuli-tim-text', state.timText);
        if (state.avatar === null) {
          if (mc.hasAttribute('data-liuli-avatar-g')) mc.removeAttribute('data-liuli-avatar-g');
        } else if (mc.dataset.liuliAvatarG !== state.avatar) mc.dataset.liuliAvatarG = state.avatar;
        if (mc.dataset.liuliG !== state.group) mc.dataset.liuliG = state.group;
      }
    } catch (e) {}
  }
  function stickAvatars() {
    try {
      // Top avatars and native layout never need viewport geometry. Clear only
      // offsets left by a previous bottom layout, before any layout read.
      if (llModeCfg.avatarPosition === 'top' || !['tg', 'tim'].includes(llModeCfg.chatStyle)) {
        for (const avatar of document.querySelectorAll('.chat-msg-area .avatar-span[data-liuli-ty]')) {
          delete avatar.dataset.liuliTy;
          if (avatar.style.transform) avatar.style.transform = '';
        }
        return;
      }
      var vp = [...document.querySelectorAll('.chat-msg-area__vlist, .chat-msg-area')].find(area => {
        const rect = area.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!vp) return;
      var vr = vp.getBoundingClientRect();
      var list = vp.querySelectorAll('.message-container');
      var groupKey = llModeCfg.chatStyle === 'tim' ? 'liuliAvatarG' : 'liuliG';
      const resetAvatar = avatar => {
        delete avatar.dataset.liuliTy;
        avatar.style.transform = '';
      };
      // 虚拟列表会复用行：以前是组尾的头像可能变成组首/中间行，旧偏移必须撤掉。
      for (const avatar of vp.querySelectorAll('.avatar-span[data-liuli-ty]')) {
        const owner = avatar.closest('.message-container');
        if (!owner || !['last', 'single'].includes(owner.dataset[groupKey])) resetAvatar(avatar);
      }
      var groupTop = null;
      var writes = [];
      for (var i = 0; i < list.length; i++) {
        var mc = list[i];
        var g = mc.dataset[groupKey];
        if (groupTop !== null && g !== 'first' && g !== 'last' && g !== 'single') continue;
        var bubble =
          mc.querySelector(':scope > .message-content__wrapper') ||
          mc.querySelector('.msg-content-container');
        if (!bubble) continue;
        var br = bubble.getBoundingClientRect();
        if (br.height < 1) continue;
        if (g === 'first' || g === 'single' || groupTop === null) groupTop = br.top;
        if (g !== 'last' && g !== 'single') continue;
        var av = mc.querySelector(':scope > .avatar-span');
        if (!av) continue;
        var h = av.offsetHeight || 32;
        var natBottom = br.bottom;
        var natTop = natBottom - h;
        var ty = 0;
        if (natBottom > vr.bottom - 4) ty = vr.bottom - 4 - natBottom;
        var minTy = groupTop - natTop;
        if (ty < minTy) ty = minTy;
        if (ty > 0) ty = 0;
        writes.push([av, Math.round(ty)]);
        groupTop = null;
      }
      for (var w = 0; w < writes.length; w++) {
        var a = writes[w][0],
          t = String(writes[w][1]);
        if (a.dataset.liuliTy !== t) {
          a.dataset.liuliTy = t;
          a.style.transform = writes[w][1] ? 'translateY(' + t + 'px)' : '';
        }
      }
    } catch (e) {}
  }
  var liuliStickRaf = 0;
  function scheduleStick() {
    if (liuliStickRaf || document.hidden) return;
    if (llModeCfg.avatarPosition === 'top' || !['tg', 'tim'].includes(llModeCfg.chatStyle)) {
      if (document.querySelector('.chat-msg-area .avatar-span[data-liuli-ty]')) stickAvatars();
      return;
    }
    liuliStickRaf = requestAnimationFrame(function () {
      liuliStickRaf = 0;
      stickAvatars();
    });
  }
  function installAvatarStick() {
    if (window.__liuliStickInstalled) return;
    window.__liuliStickInstalled = true;
    document.addEventListener(
      'scroll',
      function (e) {
        var t = e.target;
        if (t && t.closest && !t.closest('.chat-msg-area')) return;
        scheduleStick();
      },
      {
        capture: true,
        passive: true
      }
    );
    window.addEventListener('resize', scheduleStick);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(liuliStickRaf);
        liuliStickRaf = 0;
      } else {
        scheduleStick();
      }
    });
  }
  var LL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  function llNorm(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }
  function llVisibleIn(container, sel) {
    var cr = container.getBoundingClientRect();
    var out = [];
    container.querySelectorAll(sel).forEach(function (el) {
      if (el.closest('.viewport-list__measure')) return;
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < cr.top || r.top > cr.bottom) return;
      out.push({
        el: el,
        top: r.top
      });
    });
    out.sort(function (a, b) {
      return a.top - b.top;
    });
    return out.map(function (o) {
      return o.el;
    });
  }
  function llRiseIn(els, step) {
    if (motion.reduced || !els.length || typeof els[0].animate !== 'function') return;
    if (window.__liuliRowEntryMotion?.isScrolling(els[0])) return;
    var t = performance.now();
    els.slice(0, 18).forEach(function (el, i) {
      // 同一行 700ms 内只上浮一次：成员行会被「插入时同步上浮」和 llGroupMembersPass
      // 先后各触发一次，第二次会把播到一半的动画重新开始，看起来像闪了一下
      if (el.__llRiseAt && t - el.__llRiseAt < 700) return;
      el.__llRiseAt = t;
      try {
        motion.play(
          el,
          [
            {
              opacity: 0,
              transform: 'translateY(14px)'
            },
            {
              opacity: 1,
              transform: 'none'
            }
          ],
          {
            duration: 460,
            delay: i * (step || 26),
            easing: LL_EASE,
            fill: 'backwards',
            rowEntry: true
          }
        );
      } catch (e) {}
    });
  }
  var llSel = {
    id: null,
    root: null,
    obs: null
  };
  function llWatchContactList() {
    var root = document.querySelector('.recent-contact');
    if (!root || llSel.root === root) return;
    if (llSel.obs) llSel.obs.disconnect();
    llSel.root = root;
    var cur = llVisibleIn(root, '.recent-contact-item.recent-contact-item--selected')[0];
    llSel.id = cur ? cur.getAttribute('data-contact-id') : null;
    llSel.obs = new MutationObserver(function (recs) {
      var gained = null,
        lost = null;
      for (var i = 0; i < recs.length; i++) {
        var t = recs[i].target;
        if (!t.classList || !t.classList.contains('recent-contact-item')) continue;
        if (t.closest('.viewport-list__measure')) continue;
        if (recs[i].attributeName === 'data-contact-id') {
          motion.cancelEntries?.(t);
          continue;
        }
        var was = (recs[i].oldValue || '').indexOf('recent-contact-item--selected') >= 0;
        var now = t.classList.contains('recent-contact-item--selected');
        if (now && !was) gained = t;
        if (was && !now) lost = t;
      }
      if (!gained) return;
      var id = gained.getAttribute('data-contact-id');
      if (id === llSel.id) return;
      llSel.id = id;
      if (document.hidden || motion.reduced || typeof gained.animate !== 'function') return;
      var nr = gained.getBoundingClientRect();
      var lr = lost && lost.isConnected ? lost.getBoundingClientRect() : null;
      try {
        if (lr && lr.height > 0) {
          var dy = Math.round(lr.top - nr.top);
          motion.play(
            gained,
            [
              {
                transform: 'translateY(' + dy + 'px)'
              },
              {
                transform: 'translateY(0)'
              }
            ],
            {
              duration: Math.min(460, 240 + Math.abs(dy) * 0.22),
              easing: 'cubic-bezier(0.3, 1.25, 0.45, 1)',
              pseudoElement: '::before'
            }
          );
        } else {
          motion.play(
            gained,
            [
              {
                opacity: 0,
                transform: 'scale(0.94)'
              },
              {
                opacity: 1,
                transform: 'none'
              }
            ],
            {
              duration: 260,
              easing: LL_EASE,
              pseudoElement: '::before'
            }
          );
        }
      } catch (e) {}
    });
    llSel.obs.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-contact-id'],
      attributeOldValue: true,
      subtree: true
    });
    requestAnimationFrame(function () {
      llRiseIn(llVisibleIn(root, '.recent-contact-item'), 26);
    });
  }
  function llRecentSpeakers() {
    var list = document.querySelectorAll('.chat-msg-area .message-container');
    var out = {},
      rank = 0;
    for (var i = list.length - 1; i >= 0 && rank < 12 && i >= list.length - 60; i--) {
      var mc = list[i];
      if (mc.classList.contains('message-container--self') || mc.querySelector('.container--self'))
        continue;
      var av = mc.querySelector(':scope > .avatar-span');
      var n = llNorm(av && av.getAttribute('aria-label'));
      if (!n || Object.prototype.hasOwnProperty.call(out, n)) continue;
      out[n] = rank++;
    }
    return out;
  }
  /* #32.1b：当前群的稳定标识，给「管理人数」缓存当桶名。
   * 旧版直接取 `.chat-header .panel-header__title` 的整段文本，两个问题：
   *   1) 取不到时 llNorm() 返回 ""，所有群共用 llGM.staff[""] 同一个桶 → 人数串号；
   *   2) 标题里带着成员数「(260)」，有人进群 key 就变，缓存白丢。
   * 现在优先用会话列表选中项的 data-contact-id（切群才变）；
   * 但选中项可能比聊天标题晚一拍更新，名字对不上就不用，免得把人数写进别的群。
   * 退一级用标题里的群名（.chat-header__contact-name，不含成员数）。
   * 都取不到返回 ""——调用方据此跳过缓存（只按本次渲染结果展示）。 */
  function llGroupKey() {
    var name = '';
    try {
      var h = document.querySelector('.chat-header .chat-header__contact-name');
      name = llNorm((h && (h.getAttribute('aria-label') || h.textContent)) || '').replace(
        /\(\s*\d+\s*\)\s*$/,
        ''
      );
    } catch (e) {}
    try {
      var items = document.querySelectorAll('.recent-contact-item--selected[data-contact-id]');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.closest && el.closest('.viewport-list__measure')) continue;
        var id = el.getAttribute('data-contact-id');
        if (!id) continue;
        if (name && llNorm(el.textContent).indexOf(name) < 0) continue; // 名字对不上：多半还没切过去
        return 'c:' + id;
      }
    } catch (e) {}
    return name ? 'n:' + name : '';
  }
  var llGM = { key: null, staff: {} }; // staff: key -> { n: 人数, exact: 是否确定完整 }
  // Message updates only touch members whose recent-speaker state changed. Rebuild
  // this index when the member list itself changes, including virtual row reuse.
  function llGroupRecentPass(force = false) {
    var active = llGM.active;
    if (!active || !active.host.isConnected) return;
    var recent = llRecentSpeakers();
    var next = new Map();
    for (var name of Object.keys(recent)) next.set(name, recent[name] < 3 ? 'hot' : '1');
    var names = force ? active.rows.keys() : new Set([...active.values.keys(), ...next.keys()]);
    for (var name of names) {
      var value = next.get(name) || '';
      if (!force && active.values.get(name) === value) continue;
      var rows = active.rows.get(name);
      if (!rows) continue;
      for (var row of rows) {
        if (!row.isConnected || (row.dataset.liuliActive || '') === value) continue;
        if (value) row.dataset.liuliActive = value;
        else delete row.dataset.liuliActive;
      }
    }
    active.values = next;
  }
  function llGroupMembersPass() {
    try {
      var gm = document.querySelector('.group-member');
      if (!gm) {
        llGM.key = null;
        llGM.active = null;
        return;
      }
      var rows = gm.querySelectorAll('.group-user');
      if (!rows.length) {
        llGM.active = null;
        return;
      }
      // #32.1b：换群判据换成稳定 key（会话 id / 群名）。以前用整段标题文本，
      // 标题里带着成员数「(260)」——人数一变化就被误判成"换群"。
      var key = llGroupKey();
      var host = gm.querySelector('.group-member-list') || gm;
      var sig = function () {
        return Array.prototype.slice
          .call(host.querySelectorAll('.group-user__name'), 0, 6)
          .map(function (n) {
            return n.textContent;
          })
          .join('|');
      };
      if (key && key !== llGM.key) {
        var first = !llGM.seen;
        llGM.seen = true;
        llGM.key = key;
        if (first) {
          requestAnimationFrame(function () {
            llRiseIn(llVisibleIn(host, '.group-user'), 16);
          });
        } else {
          llGM.pendingSig = sig();
          llGM.pendingAt = Date.now();
        }
      } else if (llGM.pendingSig != null) {
        var now = sig();
        if (now !== llGM.pendingSig) {
          llGM.pendingSig = null;
          requestAnimationFrame(function () {
            llRiseIn(llVisibleIn(host, '.group-user'), 16);
          });
        } else if (Date.now() - llGM.pendingAt > 1500) {
          llGM.pendingSig = null;
        }
      }
      // 标题「群聊成员 N」里的 N，用来判断整张列表是否都渲染出来了
      var totalM = /(\d+)/.exec((gm.querySelector('.group-member-title') || {}).textContent || '');
      var total = totalM ? Number(totalM[1]) : 0;
      var byIdx = {};
      rows.forEach(function (r) {
        var i = Number(r.getAttribute('data-index'));
        if (!isNaN(i)) byIdx[i] = r;
      });
      var isStaff = function (r) {
        return !!(r && r.querySelector('.group-member-label'));
      };
      var inBlock = {};
      var blockEnd = -1; // 管理团队之后第一个普通成员的 index；-1 表示还没渲染到
      var started = !!byIdx[0]; // 第 0 行在不在：在才谈得上"从头数管理块"
      var j = 0;
      if (started) {
        while (byIdx[j]) {
          if (isStaff(byIdx[j])) {
            inBlock[j] = true;
            j++;
            continue;
          }
          var more = false;
          for (var k = 1; k <= 3 && byIdx[j + k]; k++)
            if (isStaff(byIdx[j + k])) {
              more = true;
              break;
            }
          if (j > 0 && more) {
            inBlock[j] = true;
            j++;
            continue;
          }
          break;
        }
        if (byIdx[j]) blockEnd = j;
        // #63：小群里所有人都是群主 / 管理员时，管理块后面没有普通成员，上面永远找不到块尾，
        // 计数一直只是「至少 N」。整张列表都渲染出来了（行数 = 标题里的群人数）就是精确值。
        else if (total > 0 && j >= total) blockEnd = j;
      }
      // 第 0 行没渲染（列表滚下去了）时没法确定整块范围，退回只看自己有没有管理员标签
      var staffAt = function (i) {
        return started ? !!inBlock[i] : isStaff(byIdx[i]);
      };
      Object.keys(byIdx).forEach(function (key2) {
        var i = Number(key2),
          r = byIdx[i];
        var g = '';
        if (staffAt(i)) {
          var prev = i > 0 && (byIdx[i - 1] ? staffAt(i - 1) : true);
          var next = byIdx[i + 1] ? staffAt(i + 1) : true;
          g = !prev && !next ? 'single' : !prev ? 'first' : !next ? 'last' : 'mid';
        }
        if ((r.dataset.liuliStaff || '') !== g) {
          if (g) r.dataset.liuliStaff = g;
          else delete r.dataset.liuliStaff;
        }
      });
      /* 管理人数（#32.1b）：只数带管理员标签的行。
       *  - blockEnd >= 0：管理块整块都渲染出来了 → 精确值，写缓存；
       *  - 只渲染到块中间（大群分批/虚拟渲染）：这只能算「至少 N」，显示成 "N+"，
       *    绝不写死成精确值——v1.3.2 对 #22 的修补就回归在这里：首屏只看到一个
       *    管理员就把 1 缓存下来，之后很难再被覆盖，于是「22 人只显示 1 人」；
       *  - 第 0 行都没渲染（列表滚下去了）→ 什么都别猜：有缓存用缓存，没有就空着。
       * key 为空（拿不到会话 id / 群名）时既不读也不写缓存，避免所有群共用
       * llGM.staff[""] 一个桶导致人数串号。 */
      // #63：刚切群时 QQ 先换标题、过一会儿才换成员行，这段时间里的行还是上一个群的
      // （pendingSig 就是在等这件事）。这时不写缓存，只显示新群自己的缓存，
      // 否则上一个群的人数会以「精确值」写进新群，小群里再也覆盖不掉。
      var stale = llGM.pendingSig != null || (total > 0 && j > total);
      var exact = blockEnd >= 0 && !stale;
      var counted = 0;
      for (var m = 0; m < (exact ? blockEnd : j); m++)
        if (byIdx[m] && isStaff(byIdx[m])) counted++;
      var rec = key ? llGM.staff[key] : null;
      if (key && started && !stale) {
        if (exact) {
          rec = { n: counted, exact: true };
          llGM.staff[key] = rec;
        } else if (counted > 0 && (!rec || (!rec.exact && counted > rec.n))) {
          rec = { n: counted, exact: false }; // 只是"至少 N"，不能盖掉已知的精确值
          llGM.staff[key] = rec;
        }
      }
      var span = gm.querySelector('.group-member-title > span');
      var showN = 0,
        showExact = false;
      if (stale) {
        if (rec && rec.n > 0) {
          showN = rec.n;
          showExact = !!rec.exact;
        }
      } else if (started && exact) {
        showN = counted;
        showExact = true;
      } else if (rec && rec.n > 0) {
        showN = rec.n;
        showExact = !!rec.exact;
      } else if (started && counted > 0) {
        showN = counted;
        showExact = false;
      }
      if (total > 0 && showN > total) {
        showN = 0;
        if (key) delete llGM.staff[key];
      }
      if (span) {
        var want = showN > 0 ? (showExact ? String(showN) : showN + '+') : '';
        if ((span.dataset.liuliStaff || '') !== want) {
          if (want) span.dataset.liuliStaff = want;
          else delete span.dataset.liuliStaff;
        }
      }
      var activeRows = new Map();
      rows.forEach(function (r) {
        var nm = r.querySelector('.group-user__name');
        var name = llNorm(nm && nm.textContent);
        if (!activeRows.has(name)) activeRows.set(name, new Set());
        activeRows.get(name).add(r);
      });
      llGM.active = { host: gm, rows: activeRows, values: new Map() };
      llGroupRecentPass(true);
    } catch (e) {}
  }
  function prepareMessageLayout(roots) {
    for (const root of roots) {
      syncPictureRatios(root);
      moveSenderIntoBubble(root);
    }
    groupMessages();
  }
  function liuliMessagePass(roots, layoutPrepared = false) {
    if (!layoutPrepared) prepareMessageLayout(roots);
    window.__liuliVoiceLayout?.refresh();
    for (const root of roots) {
      markQuoteRoots(root);
      llMarkdownPass(root);
      llAtPass(root);
    }
    scheduleStick();
  }
  var llMsgSeen = {
    chat: null,
    max: null
  };
  function llMessagePeerKey(area = document.querySelector('.chat-msg-area')) {
    const messages = area?.querySelectorAll('.message');
    if (!messages?.length) return '';
    let first = '';
    for (const message of messages) {
      if (message.closest('.viewport-list__measure')) continue;
      const record = window.LiuliQQ?.messageRecord(message);
      const peer = record && (record.peerUid || record.peerUin);
      if (!peer || record.chatType == null) continue;
      const key = String(record.chatType) + ':' + String(peer);
      if (first && key !== first) return '';
      if (!first) first = key;
    }
    // Native routing may briefly retain rows from both conversations. Wait for
    // one peer throughout the mounted range before revealing the new messages.
    return first;
  }
  function llChatKey() {
    const peer = llMessagePeerKey();
    if (peer) return 'p:' + peer;
    const selected = Array.from(document.querySelectorAll('.recent-contact-item--selected[data-contact-id]'))
      .find(item => !item.closest('.viewport-list__measure'));
    if (selected) return 'c:' + selected.getAttribute('data-contact-id');
    var t = document.querySelector('.aio .chat-header .panel-header__title');
    return t ? (t.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function llMsgId(el) {
    try {
      return el && /^\d+$/.test(el.id) ? BigInt(el.id) : null;
    } catch (e) {
      return null;
    }
  }
  function llMotionPass(added) {
    try {
      const key = llChatKey();
      if (key !== llMsgSeen.chat) {
        const items = document.querySelectorAll('.chat-msg-area .ml-item[id]');
        if (!items.length) return;
        const first = llMsgSeen.chat !== null;
        llMsgSeen.chat = key;
        let max = null;
        items.forEach(item => {
          const id = llMsgId(item);
          if (id !== null && (max === null || id > max)) max = id;
        });
        llMsgSeen.max = max;
        // 换会话：消息区整体轻轻浮上来
        // 点击会话切换时由 installSwitchMotion 的控制器负责这一段（它要等滚动稳定），这里跳过
        if (first && !motion.reduced) {
          const area = document.querySelector('.chat-msg-area');
          if (area && !area.hasAttribute('data-ll-switching') && typeof area.animate === 'function')
            motion.play(
              area,
              [
                { opacity: 0, transform: 'translateY(10px)' },
                { opacity: 1, transform: 'none' }
              ],
              { duration: 280, easing: LL_EASE }
            );
        }
        return;
      }
      // New rows animate synchronously in llHandleAdded, before their first
      // paint. A second wrapper animation in this rAF pass made visible rows
      // jump back to opacity zero, and mistook virtual history for live IDs.
    } catch (e) {}
  }

  /* ---------- 消息入场：级联 ----------
   * 只给两种情况做动画，滚动加载历史时不做（否则一滚就闪）：
   *   1. 刚切到一个会话：600ms 内出现的消息，从下往上依次浮入，每条错开 28ms，最多 14 条
   *   2. 新消息：加到列表最末尾的那条
   * 动画只用 opacity + transform，交给合成层，不触发排版。 */
  let llEnterPeer = '';
  let llEnterUntil = 0;
  const LL_ENTER_MAX = 14;

  function llCurrentPeer() {
    const rec = llMsgRecordOf(document.querySelector('.chat-msg-area .message'));
    return rec ? String(rec.peerUid) : '';
  }

  function llAnimateEnter(items) {
    if (!items.length || motion.reduced) return;
    // 越靠下（越新）越先出来
    items.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const visible = items.slice(0, LL_ENTER_MAX);
    visible.forEach((el, i) => {
      el.style.setProperty('--ll-enter-i', String(i));
      el.classList.remove('ll-enter');
    });
    // Restart the cascade with one layout flush, not one per message.
    if (visible.length) void visible[0].offsetWidth;
    visible.forEach((el, i) => {
      el.classList.add('ll-enter');
      clearTimeout(el.__llEnterT);
      el.__llEnterT = setTimeout(() => el.classList.remove('ll-enter'), 400 + i * 28);
    });
  }

  /* 群成员行插入时同步起上浮（和消息级联同一个思路：在 MutationObserver 回调里、
   * 首次绘制前就把行压成透明，避免新成员先露出来一帧）。
   * 只在「换了群之后第一次出现成员行」时触发，同一个群里滚动成员列表不触发。
   * 点击切换时 installSwitchMotion 也会起一次，llRiseIn 自己去重。 */
  let llMembersRiseKey = null;
  function llMembersArrived(records) {
    let hit = false;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (
          n.nodeType === 1 &&
          (n.classList.contains('group-user') || (n.querySelector && n.querySelector('.group-user')))
        ) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (!hit || motion.reduced) return;
    const key = llGroupKey();
    if (!key || key === llMembersRiseKey) return;
    const gm = document.querySelector('.group-member');
    if (!gm) return;
    const host = gm.querySelector('.group-member-list') || gm;
    const rows = llVisibleIn(host, '.group-user');
    if (!rows.length) return; // 还没排好版：下一批插入或 llGroupMembersPass 会接上
    llMembersRiseKey = key;
    llRiseIn(rows, 16);
  }

  function llHandleAdded(records) {
    window.__liuliRowEntryMotion?.added(records);
  }

  function installRowEntryMotion() {
    window.__liuliRowEntryMotion?.dispose();
    let peer = '', highTime = 0, highSeq = null, disposed = false, activeArea = null;
    const seen = new Set(), scrolling = new WeakMap(), legacyEntries = new Map();
    const scopeOf = node => node?.closest?.('.chat-msg-area,.recent-contact');
    const recordOf = row => {
      try { return window.LiuliQQ?.messageRecord(row.querySelector('.message') || row) || null; } catch (_) { return null; }
    };
    const keyOf = record => record ? [record.chatType, record.peerUid || record.peerUin || ''].join(':') : '';
    const idOf = (row, record) => String(record?.msgId || row.id || '');
    function seqOf(record) {
      try { return record?.msgSeq != null ? BigInt(record.msgSeq) : null; } catch (_) { return null; }
    }
    function remember(row, record) {
      const id = idOf(row, record);
      if (id) seen.add(id);
      if (seen.size > 2048) seen.delete(seen.values().next().value);
      const time = Number(record?.msgTime);
      if (time > highTime) highTime = time;
      const seq = seqOf(record);
      if (seq !== null && (highSeq === null || seq > highSeq)) highSeq = seq;
    }
    function seed(area = document.querySelector('.chat-msg-area')) {
      activeArea = area;
      const rows = [...(area?.querySelectorAll('.ml-item[id]') || [])]
        .filter(row => !row.closest('.viewport-list__measure'));
      const nextPeer = rows.map(recordOf).map(keyOf).find(Boolean) || '';
      if (nextPeer !== peer) { peer = nextPeer; seen.clear(); highTime = 0; highSeq = null; }
      for (const row of rows) {
        const record = recordOf(row);
        if (keyOf(record) === peer) remember(row, record);
      }
    }
    function cancelRow(row) {
      if (!row) return;
      clearTimeout(row.__llEnterT);
      delete row.__llEnterT;
      if (row.classList.contains('ll-enter')) row.classList.remove('ll-enter');
      motion.cancelEntries?.(row);
      for (const animation of legacyEntries.get(row) || []) animation.cancel();
      legacyEntries.delete(row);
    }
    // Only the disposable live adapter registers pre-upgrade llRiseIn entries.
    // Production entries already belong to motion.cancelEntries; never query
    // every contact's animations on each wheel/scroll event.
    function trackLegacyEntry(row, animation) {
      if (disposed || !row || !animation) return;
      if (!legacyEntries.has(row)) legacyEntries.set(row, new Set());
      const entries = legacyEntries.get(row);
      entries.add(animation);
      const release = () => {
        entries.delete(animation);
        if (!entries.size && legacyEntries.get(row) === entries) legacyEntries.delete(row);
      };
      animation.finished.then(release, release);
    }
    function cancelScope(scope) {
      for (const row of scope?.querySelectorAll('.ml-item.ll-enter') || []) cancelRow(row);
      for (const row of legacyEntries.keys()) if (row === scope || scope?.contains(row)) cancelRow(row);
      motion.cancelEntries?.(scope);
    }
    function atTail(area) {
      const scroller = area.querySelector('.ml-root, #ml-root, .chat-msg-area__vlist') || area;
      const extent = scroller.scrollHeight - scroller.clientHeight;
      if (extent <= 4) return true;
      // QQ's message scroller is column-reverse: its live tail is scrollTop=0.
      const reversed = scroller.scrollTop < 0 || getComputedStyle(scroller).flexDirection === 'column-reverse';
      return reversed ? Math.abs(scroller.scrollTop) <= 4 : extent - scroller.scrollTop <= 4;
    }
    function added(records) {
      if (disposed) return;
      const rows = new Set();
      for (const record of records) for (const node of record.addedNodes || []) {
        if (node.nodeType !== 1 || !node.isConnected || !node.closest('.chat-msg-area')) continue;
        if (node.matches('.ml-item[id]')) rows.add(node);
        for (const row of node.querySelectorAll('.ml-item[id]')) rows.add(row);
      }
      if (!rows.size) return;
      for (const row of rows) {
        const area = row.closest('.chat-msg-area');
        if (row.closest('.viewport-list__measure') || (area !== activeArea &&
            ((activeArea?.isConnected && activeArea.getClientRects().length) || !area.getClientRects().length))) rows.delete(row);
      }
      if (!rows.size) return;
      const nextPeer = [...rows].map(recordOf).map(keyOf).find(Boolean);
      const area = [...rows][0].closest('.chat-msg-area');
      if (!nextPeer || nextPeer !== peer || area.hasAttribute('data-ll-switching')) { seed(area); return; }
      const fresh = [], now = Date.now() / 1000;
      for (const row of rows) {
        if (row.closest('.viewport-list__measure')) continue;
        const record = recordOf(row), id = idOf(row, record), time = Number(record?.msgTime), seq = seqOf(record);
        const unseen = id && !seen.has(id);
        // DOM tail position and a larger random message ID are not evidence of
        // live delivery. Require a recent native timestamp and a forward seq.
        if (unseen && keyOf(record) === peer && time >= now - 90 && time <= now + 15 &&
            time >= highTime && (seq === null || highSeq === null || seq > highSeq)) fresh.push(row);
        if (keyOf(record) === peer) remember(row, record);
      }
      // History mounts never need tail geometry. Decide from the native record
      // first, then read scroll bounds only for plausible live deliveries.
      if (fresh.length && !document.hidden && !motion.reduced &&
          (scrolling.get(area) || 0) < performance.now() && atTail(area)) llAnimateEnter(fresh);
    }
    function userScroll(event) {
      const scope = scopeOf(event.target);
      if (!scope) return;
      if (event.type === 'keydown' && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) ||
          event.target.closest('input,textarea,[contenteditable="true"]'))) return;
      if (event.type === 'pointerdown' && !event.target.closest('.v-scrollbar,.v-scrollbar-thumb,.v-scrollbar-track')) return;
      scrolling.set(scope, performance.now() + 240);
      cancelScope(scope);
    }
    function onScroll(event) {
      const scope = scopeOf(event.target);
      if (scope && (scrolling.get(scope) || 0) > performance.now()) userScroll(event);
    }
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const row = record.target;
          if (row.matches('.ml-item,.recent-contact-item')) {
            cancelRow(row);
            if (row.matches('.ml-item') && row.closest('.chat-msg-area') === activeArea &&
                !row.closest('.viewport-list__measure')) {
              const record = recordOf(row);
              if (keyOf(record) === peer) remember(row, record);
            }
          }
        } else for (const node of record.removedNodes) if (node.nodeType === 1) {
          if (node.matches('.ml-item,.recent-contact-item')) cancelRow(node);
          cancelScope(node);
        }
      }
      added(records);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['id', 'data-contact-id'] });
    for (const name of ['wheel', 'touchmove', 'keydown', 'pointerdown']) document.addEventListener(name, userScroll, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const api = {
      added, refresh: seed, cancel: cancelScope, trackLegacyEntry,
      isScrolling(node) { return (scrolling.get(scopeOf(node)) || 0) > performance.now(); },
      dispose() {
        if (disposed) return;
        disposed = true; observer.disconnect();
        for (const name of ['wheel', 'touchmove', 'keydown', 'pointerdown']) document.removeEventListener(name, userScroll, true);
        document.removeEventListener('scroll', onScroll, true);
        for (const scope of document.querySelectorAll('.chat-msg-area,.recent-contact')) cancelScope(scope);
        for (const row of legacyEntries.keys()) cancelRow(row);
        seen.clear();
        if (window.__liuliRowEntryMotion === api) delete window.__liuliRowEntryMotion;
      }
    };
    window.__liuliRowEntryMotion = api;
    seed();
    return api;
  }

  /* ---------- 切换会话：过渡动画 ----------
   * 点击会话列表里的另一个会话时，旧内容先离开、新内容到了再进入。
   *   1) 离场：pointerdown（捕获阶段）立刻给「标题 / 消息区 / 群公告 / 成员列表」播 120ms 淡出上移。
   *      这是为了点击就有反馈——实测 QQ 要 161ms 才换 DOM，之前这段时间屏幕上毫无变化。
   *      这里不用 motion.play：它会强制 fill:'backwards' 并在结束后 cancel；
   *      离场必须 fill:'forwards'，才能把旧内容按在隐藏状态，等新内容到了再 cancel。
   *   2) 入场：QQ 不是一次性换完（标题 / 公告 / 消息约 161ms 到，群成员约 365ms 才到），
   *      所以不做整体过渡：各部分各自检测「新内容到了」，先 cancel 自己的离场，再播自己的入场。
   *   3) 群公告高度会随内容突变（例如 180px → 56px），用 FLIP 位移让成员卡片从旧位置滑到
   *      新位置，而不做高度动画（高度动画每帧都要排版）。
   *   ！`.group-box` 自己带 backdrop-filter 模糊，对它做 opacity / transform 会让模糊失效，
   *      所以只动它的子元素；滑动需要遮挡溢出时给它 overflow: clip（clip 不会让模糊失效），
   *      不用 hidden。
   * 检测方式：rAF 轮询，从点击开始最多 1500ms；超时兜底把还没恢复的部分 cancel 离场并入场，
   * 保证内容一定会出现。检测期间又点了别的会话就结束这一轮重新开始。
   * 非点击方式（键盘 / 搜索 / 通知）切换没有离场也没有 data-ll-switching，原有行为不变。
   */
  let llSwitchInstalled = false;
  function installSwitchMotion() {
    if (llSwitchInstalled || motion.reduced) return;
    window.__liuliSwitchMotion?.dispose();
    llSwitchInstalled = true;

    const SW_TITLE = '.aio .chat-header .panel-header__title';
    const SW_AREA = '.chat-msg-area';
    const SW_NOTICE = '.group-notice';
    const SW_MEMBER = '.group-member';
    const SW_OUT_FRAMES = [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(-6px)' }
    ];
    const SW_IN_FRAMES = [
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'none' }
    ];
    const SW_MAX = 1500;

    let round = null; // 当前这一轮切换的检测状态
    let raf = 0;
    let clipTimer = 0;
    let clipEl = null;
    let clipPrev = '';
    let noticeEl = null;
    let noticeH = -1;
    let noticeRo = null;
    let noticeMo = null;

    function swText(el) {
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }
    function swMemberHost() {
      const gm = document.querySelector(SW_MEMBER);
      return gm ? gm.querySelector('.group-member-list') || gm : null;
    }
    function swMemberSig() {
      try {
        const host = swMemberHost();
        if (!host) return '';
        return Array.prototype.slice
          .call(host.querySelectorAll('.group-user__name'), 0, 6)
          .map(n => n.textContent || '')
          .join('|');
      } catch (e) {
        return '';
      }
    }
    function swVisibleItems(area) {
      const out = [];
      try {
        if (!area) return out;
        const cr = area.getBoundingClientRect();
        area.querySelectorAll('.ml-item').forEach(el => {
          if (el.closest('.viewport-list__measure')) return;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          if (r.bottom < cr.top || r.top > cr.bottom) return;
          out.push(el);
        });
      } catch (e) {}
      return out;
    }

    /* 离场：原生 el.animate + fill:'forwards'，动画对象存进 Map 以便新内容到达时取消 */
    function swExit(exits, el) {
      if (!el || !el.isConnected || typeof el.animate !== 'function') return;
      try {
        const animation = el.animate(SW_OUT_FRAMES, {
            duration: 120,
            easing: 'cubic-bezier(0.4, 0, 1, 1)',
            fill: 'forwards'
          });
        // Resolve the start now; a cold route can block the first render frame.
        animation.startTime = document.timeline.currentTime;
        exits.set(el, animation);
      } catch (e) {}
    }
    function swDropExit(exits, el) {
      if (!el) return;
      try {
        const a = exits.get(el);
        if (a) {
          a.cancel();
          exits.delete(el);
        }
      } catch (e) {}
    }
    function swEnter(el) {
      if (!el || !el.isConnected) return;
      try {
        motion.play(el, SW_IN_FRAMES, { duration: 220, easing: LL_EASE });
      } catch (e) {}
    }
    function swAreaReady() {
      try {
        if (round && round.areaEl) round.areaEl.removeAttribute('data-ll-switching');
        document.querySelectorAll(SW_AREA).forEach(el => el.removeAttribute('data-ll-switching'));
      } catch (e) {}
    }
    function swStopLoop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    function swDropAll(st) {
      try {
        st.exits.forEach(a => {
          try {
            a.cancel();
          } catch (e) {}
        });
        st.exits.clear();
      } catch (e) {}
    }
    function swFinish(st) {
      swStopLoop();
      swDropAll(st);
      swAreaReady();
      if (round === st) round = null;
    }
    function swAbort() {
      const st = round;
      if (!st) return;
      swFinish(st);
    }

    function swStart() {
      swAbort();
      const titleEl = document.querySelector(SW_TITLE);
      const area = document.querySelector(SW_AREA);
      const notice = document.querySelector(SW_NOTICE);
      const st = {
        at: performance.now(),
        oldTitle: swText(titleEl),
        oldPeer: llMessagePeerKey(area),
        oldMemberSig: swMemberSig(),
        exits: new Map(),
        titleEl: titleEl,
        noticeEl: notice,
        noticeText: swText(notice),
        memberEl: document.querySelector(SW_MEMBER),
        areaEl: area,
        titleDone: false,
        noticeDone: false,
        membersDone: false,
        messagesDone: false,
        titleChanged: false,
        sampleId: '',
        sampleTop: 0,
        stable: 0
      };
      round = st;
      swExit(st.exits, st.titleEl);
      swExit(st.exits, st.areaEl);
      swExit(st.exits, st.noticeEl);
      swExit(st.exits, st.memberEl);
      try {
        if (area) area.setAttribute('data-ll-switching', '');
      } catch (e) {}
      raf = requestAnimationFrame(swTick);
    }

    function swCheckTitle(st) {
      if (st.titleDone) return;
      const el = document.querySelector(SW_TITLE);
      if (!el) return;
      const peer = llMessagePeerKey();
      if (el === st.titleEl && swText(el) === st.oldTitle && (!peer || peer === st.oldPeer)) return;
      st.titleDone = true;
      st.titleChanged = true;
      swDropExit(st.exits, st.titleEl);
      swDropExit(st.exits, el);
      swEnter(el);
    }

    function swCheckNotice(st) {
      if (st.noticeDone) return;
      const el = document.querySelector(SW_NOTICE);
      if (el !== st.noticeEl) {
        // 被替换或消失：旧元素上的离场已经没有意义，新元素直接入场
        st.noticeDone = true;
        swDropExit(st.exits, st.noticeEl);
        st.noticeEl = el;
        st.noticeText = swText(el);
        if (!el) return;
        swDropExit(st.exits, el);
        swEnter(el);
        return;
      }
      if (!el) return;
      const txt = swText(el);
      if (txt === st.noticeText) return;
      st.noticeText = txt;
      st.noticeDone = true;
      swDropExit(st.exits, el);
      swEnter(el);
    }

    function swCheckMembers(st) {
      if (st.membersDone) return;
      const el = document.querySelector(SW_MEMBER);
      if (!st.memberFrames) {
        if (swMemberSig() === st.oldMemberSig) return;
        st.memberFrames = 1;
      }
      // 新成员到了：先在同一帧里给可视行起上浮（带 backwards，行此刻就是透明的），
      // 再撤掉离场。不能等 llGroupMembersPass——它要等下一次 flush，实测晚 100ms 左右，
      // 这段时间新成员会整块露出来再上浮（「闪现」）。可视区还没排好版就再等一帧，最多 4 帧。
      const host = el && (el.querySelector('.group-member-list') || el);
      const rows = host ? llVisibleIn(host, '.group-user') : [];
      if (!rows.length && st.memberFrames++ < 4) return;
      llRiseIn(rows, 16);
      st.membersDone = true;
      // 成员只恢复可见：逐行上浮由 llGroupMembersPass 自己负责，
      // 这里再播一次整体入场会和它叠加
      swDropExit(st.exits, st.memberEl);
      swDropExit(st.exits, el);
    }

    function swCheckMessages(st) {
      if (st.messagesDone || !st.titleChanged) return;
      const area = document.querySelector(SW_AREA);
      if (!area) return;
      // Selection/title can update before QQ replaces the message list. In
      // particular, two distinct private chats can share the exact same title.
      if (st.oldPeer) {
        const peer = llMessagePeerKey(area);
        if (!peer || peer === st.oldPeer) return;
      }
      const prevArea = st.areaEl;
      st.areaEl = area;
      // The final visible row is sufficient to detect settling. Measuring every
      // message on each cold-route frame adds layout work before its first paint.
      const bounds = area.getBoundingClientRect();
      const candidates = area.querySelectorAll('.ml-item');
      let last = null;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const item = candidates[i];
        if (item.closest('.viewport-list__measure')) continue;
        const rect = item.getBoundingClientRect();
        if (rect.width > 2 && rect.height > 2 && rect.bottom >= bounds.top && rect.top <= bounds.bottom) {
          last = item;
          break;
        }
      }
      if (!last) {
        st.stable = 0;
        return;
      }
      const id = String(last.id || '');
      const top = last.getBoundingClientRect().top;
      if (id && id === st.sampleId && Math.abs(top - st.sampleTop) < 0.5) {
        st.stable++;
      } else {
        st.stable = 0;
        st.sampleId = id;
        st.sampleTop = top;
      }
      // 连续 2 帧不变才算稳定：QQ 先把消息行摆在错误的滚动位置，约 300ms 才滚到底
      if (st.stable < 2) return;
      st.messagesDone = true;
      window.__liuliSidePaneMotion?.messageReady();
      swDropExit(st.exits, prevArea);
      swDropExit(st.exits, area);
      swEnter(area);
      try {
        llAnimateEnter(swVisibleItems(area));
      } catch (e) {}
      swAreaReady();
    }

    function swTimeout(st) {
      // 兜底：还没恢复的部分统统 cancel 离场并入场，保证内容一定会出现
      try {
        if (!st.titleDone) {
          const el = document.querySelector(SW_TITLE);
          swDropExit(st.exits, st.titleEl);
          swDropExit(st.exits, el);
          swEnter(el);
        }
        if (!st.noticeDone) {
          const el = document.querySelector(SW_NOTICE);
          swDropExit(st.exits, st.noticeEl);
          swDropExit(st.exits, el);
          swEnter(el);
        }
        if (!st.membersDone) {
          swDropExit(st.exits, st.memberEl);
          swDropExit(st.exits, document.querySelector(SW_MEMBER));
        }
        if (!st.messagesDone) {
          window.__liuliSidePaneMotion?.messageReady();
          const el = document.querySelector(SW_AREA);
          swDropExit(st.exits, st.areaEl);
          swDropExit(st.exits, el);
          swEnter(el);
        }
      } catch (e) {}
      swFinish(st);
    }

    function swTick() {
      raf = 0;
      const st = round;
      if (!st) return;
      try {
        if (document.hidden) {
          swAbort();
          return;
        }
        swCheckTitle(st);
        // 右栏卡片向右离场由 side-pane-motion.js 负责，与 QQ 原生切换并行。
        swCheckNotice(st);
        swCheckMembers(st);
        swCheckMessages(st);
        // 消息区元素可能被整个替换：没恢复之前每帧补一次标记，
        // 否则新元素上没标记，llHandleAdded 会提前级联一遍，和控制器叠加
        if (!st.messagesDone) {
          const area = document.querySelector(SW_AREA);
          if (area && !area.hasAttribute('data-ll-switching')) {
            try {
              area.setAttribute('data-ll-switching', '');
            } catch (e) {}
          }
        }
        if (st.titleDone && st.noticeDone && st.membersDone && st.messagesDone) {
          swFinish(st);
          return;
        }
        if (performance.now() - st.at > SW_MAX) {
          swTimeout(st);
          return;
        }
      } catch (e) {
        try {
          swTimeout(st);
        } catch (e2) {}
        return;
      }
      raf = requestAnimationFrame(swTick);
    }

    /* ---------- 群公告高度：FLIP 位移 ---------- */
    function swClipBox() {
      const box = document.querySelector('.group-box');
      if (!box) return;
      if (clipEl !== box) {
        if (clipEl) {
          try {
            clipEl.style.overflow = clipPrev;
          } catch (e) {}
        }
        clipEl = box;
        clipPrev = box.style.overflow || '';
      }
      try {
        // clip 不会让 .group-box 的 backdrop-filter 失效，hidden 会
        box.style.overflow = 'clip';
      } catch (e) {}
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => {
        try {
          if (clipEl) clipEl.style.overflow = clipPrev;
        } catch (e) {}
      }, 320);
    }
    function swNoticeFlip(d) {
      if (!d || Math.abs(d) < 2 || document.hidden || motion.reduced) return;
      try {
        const gm = document.querySelector(SW_MEMBER);
        if (!gm || !gm.isConnected || typeof gm.animate !== 'function') return;
        swClipBox();
        // FLIP：布局已经变了，让成员卡片从旧位置滑到新位置
        motion.play(gm, [{ transform: 'translateY(' + -d + 'px)' }, { transform: 'none' }], {
          duration: 260,
          easing: LL_EASE
        });
        // 公告变长时，成员卡片从上面往下滑，滑动途中会盖住公告新多出来的那截。
        // 同步把公告的底边从「旧高度」裁到「新高度」，让公告的可见底边始终贴着成员卡片的上沿。
        // clip-path 只裁 .group-notice 自己（它和子元素都不带模糊），不影响 .group-box 的毛玻璃。
        const notice = document.querySelector(SW_NOTICE);
        if (d > 0 && notice && typeof notice.animate === 'function')
          motion.play(notice, [{ clipPath: 'inset(0 0 ' + d + 'px 0)' }, { clipPath: 'inset(0)' }], {
            duration: 260,
            easing: LL_EASE
          });
      } catch (e) {}
    }
    function swOnNoticeResize() {
      try {
        if (!noticeEl || !noticeEl.isConnected) return;
        const h = noticeEl.getBoundingClientRect().height;
        // 第一次绑定时只记录高度，不播动画
        if (noticeH < 0) {
          noticeH = h;
          return;
        }
        const d = h - noticeH;
        noticeH = h;
        if (Math.abs(d) < 2) return;
        // 点击切换途中、新成员还没到：公告已经换成新群的了，下面还是旧群的成员。
        // 这时不做位移（位移的是马上要被换掉的旧成员，变长时会压在新公告上），
        // 直接把旧成员的离场播完、保持隐藏，等新成员到了再上浮。
        // 实测 QQ 点击后主线程会卡 250ms 左右，离场常常还没开始播，所以要手动 finish。
        const st = round;
        if (st && !st.membersDone) {
          st.exits.forEach((a, el) => {
            try {
              if (el.matches && el.matches(SW_MEMBER)) a.finish();
            } catch (e) {}
          });
          return;
        }
        swNoticeFlip(d);
      } catch (e) {}
    }
    function swBindNotice() {
      try {
        const el = document.querySelector(SW_NOTICE);
        if (el === noticeEl) return;
        noticeEl = el;
        if (noticeRo) {
          try {
            noticeRo.disconnect();
          } catch (e) {}
        }
        if (!el) return; // 换到没有群公告的会话：保留上次高度，回来时还能做位移
        if (!noticeRo && typeof ResizeObserver === 'function') {
          noticeRo = new ResizeObserver(swOnNoticeResize);
        }
        if (noticeRo) {
          try {
            noticeRo.observe(el);
          } catch (e) {}
        }
      } catch (e) {}
    }

    function swPointerDown(e) {
        try {
          if (e.button !== 0 || document.hidden || motion.reduced) return;
          const t = e.target;
          if (!t || typeof t.closest !== 'function') return;
          const item = t.closest('.recent-contact-item');
          if (!item) return;
          // 分组标题只折叠列表，不应触发当前聊天的退出动画。
          const pinHeading = t.closest('.liuli-pin-heading');
          const pinY = e.clientY - item.getBoundingClientRect().top;
          if (pinHeading || (item.querySelector(':scope > .liuli-pin-heading') && pinY >= -28 && pinY < 0)) return;
          if (item.closest('.viewport-list__measure')) return;
          if (item.classList.contains('recent-contact-item--selected')) return;
          swStart();
        } catch (err) {
          try {
            swAbort();
          } catch (e2) {}
        }
    }
    document.addEventListener('pointerdown', swPointerDown, true);

    try {
      // 群公告元素可能被整块替换：靠 MutationObserver 重新绑定 ResizeObserver
      noticeMo = new MutationObserver(() => {
        try {
          if (document.hidden) return;
          swBindNotice();
          if (round && !round.messagesDone) {
            const area = document.querySelector(SW_AREA);
            if (area && area !== round.areaEl) {
              area.setAttribute('data-ll-switching', '');
              controller.holdArea(area);
            }
          }
        } catch (e) {}
      });
      noticeMo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    swBindNotice();
    const controller = { peerKey: llMessagePeerKey, holdArea(area) {
      if (!round || round.messagesDone || !area?.isConnected) return;
      if (!round.exits.has(area)) swExit(round.exits, area);
      // A replacement message area has no outgoing effect to hold it hidden.
      // Give it an owned hold before its first paint, then release it normally.
      try { round.exits.get(area)?.finish(); } catch (_) {}
    }, dispose() {
      swAbort();
      swStopLoop();
      clearTimeout(clipTimer);
      if (clipEl) clipEl.style.overflow = clipPrev;
      noticeRo?.disconnect();
      noticeMo?.disconnect();
      document.removeEventListener('pointerdown', swPointerDown, true);
      llSwitchInstalled = false;
      if (window.__liuliSwitchMotion === controller) delete window.__liuliSwitchMotion;
    } };
    window.__liuliSwitchMotion = controller;
  }

  function installPageObserver() {
    window.__liuliPageObserver?.dispose();
    const colors = createMessageColorRepair({ afterWrite: () => observer.takeRecords() });
    llColorRepair?.dispose();
    llColorRepair = colors;
    const roots = new Set();
    const work = new Set();
    const addedMessages = new Set();
    const themeUi =
      '#liuli-settings-dialog, #liuli-settings-entry, #liuli-input-overlay, #liuli-toast, #liuli-scroll-time, .liuli-top-hint, #liuli-nav-handle, #liuli-ctl-shield, .liuli-pin-heading, .liuli-pin-surface, #liuli-video-layer, .liuli-pane-transition, .liuli-pane-prepared';
    const structure =
      '#app, .global-container, .window-title-bar, .window-control-area, .chat-input-area, .msg-input, .chat-msg-area, .recent-contact, .container-sidebar';
    let frame = 0;
    let flushing = false;
    let needsRefresh = false;
    let measured = [];
    let disposed = false;
    let messageLayoutDirty = false;
    let messageLayoutPrepared = false;
    const virtualScopes = '.chat-msg-area, .recent-contact, .group-member';
    const contentRows = '.ml-item, .message, .message-container, .group-user, .recent-contact-item';
    const layoutProperties = /^(?:transform|translate|rotate|scale|transform-origin|position|inset(?:-(?:block|inline)(?:-(?:start|end))?)?|top|right|bottom|left|(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|flex(?:-(?:basis|grow|shrink|direction|wrap))?|(?:row-|column-)?gap|align-(?:items|self|content)|justify-(?:items|self|content)|order|will-change|contain|content-visibility|overflow(?:-[xy])?)$/;
    const oldStyle = document.createElement('i').style;

    function elementOf(node) {
      return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    }
    function isThemeUi(element) {
      return !element || element.closest(themeUi) || element.matches('style, script');
    }
    function isVirtualContainer(element) {
      if (!element.closest(virtualScopes) || element.closest(contentRows)) return false;
      return !!element.querySelector(contentRows) || !element.textContent.trim();
    }
    function changedStyleProperties(record, target) {
      oldStyle.cssText = record.oldValue || '';
      const names = new Set([...oldStyle, ...target.style]);
      return [...names].filter(name =>
        oldStyle.getPropertyValue(name) !== target.style.getPropertyValue(name) ||
        oldStyle.getPropertyPriority(name) !== target.style.getPropertyPriority(name)
      );
    }
    function nativeClasses(value) {
      return (value || '').split(/\s+/)
        .filter(name => name && !/^(liuli-|ll-)/.test(name)).sort().join(' ');
    }
    function containerRoles(value) {
      return (value || '').split(/\s+/)
        .filter(name => /^(?:chat-msg-area|recent-contact|group-member|ml-item|message|message-container|group-user|recent-contact-item)(?:$|[-_])/.test(name))
        .sort().join(' ');
    }
    function deferHidden() {
      needsRefresh = true;
      // Seed the current messages on resume instead of replaying the hidden backlog.
      llMsgSeen.chat = null;
      cancelAnimationFrame(frame);
      frame = 0;
      roots.clear();
      work.clear();
      addedMessages.clear();
      messageLayoutDirty = messageLayoutPrepared = false;
    }
    function schedule() {
      if (disposed) return;
      if (document.hidden) {
        deferHidden();
        return;
      }
      if (!frame) frame = requestAnimationFrame(flush);
    }
    function classify(element, descendants = false, contentChanged = true) {
      const touches = selector =>
        element.closest(selector) || (descendants && element.querySelector(selector));
      if (contentChanged && touches('.chat-msg-area, .topbar-profile')) {
        work.add('messages');
        messageLayoutDirty = true;
      }
      if (contentChanged && touches('.group-member')) work.add('members');
      if (
        touches(
          '.chat-func-bar, .sidebar__nav, .sidebar__menu, .aio-right-click-menu, .window-control-area'
        )
      )
        work.add('layout');
      if (touches('.chat-input-area, .expression-panel')) work.add('geometry');
      if (descendants && (element.matches(structure) || element.querySelector(structure)))
        work.add('structure');
    }
    const observer = new MutationObserver(records => {
      if (disposed) return;
      if (document.hidden) {
        deferHidden();
        return;
      }
      const childRecords = records.filter(record => record.type === 'childList');
      for (const record of records) {
        const target = elementOf(record.target);
        if (isThemeUi(target)) continue;
        let contentChanged = true;
        if (record.type === 'attributes') {
          if (
            target === document.body ||
            record.oldValue === target.getAttribute(record.attributeName)
          )
            continue;
          if (record.attributeName === 'class') {
            if (nativeClasses(record.oldValue) === nativeClasses(target.getAttribute('class')))
              continue;
            // Virtual wrappers toggle presentation classes while scrolling. Keep
            // actual row/scope identity changes observable, including recycled rows.
            if (!target.matches(virtualScopes) && isVirtualContainer(target) &&
                containerRoles(record.oldValue) === containerRoles(target.getAttribute('class')))
              continue;
          } else if (record.attributeName === 'style') {
            const properties = changedStyleProperties(record, target);
            if (!properties.length) continue;
            if (isVirtualContainer(target) && properties.every(name => layoutProperties.test(name)))
              continue;
            // Color/material overrides still inspect this changed subtree. An
            // inline style update alone does not change message grouping/content.
            contentChanged = false;
          }
        }
        if (record.type === 'childList') {
          const nodes = [...record.addedNodes, ...record.removedNodes];
          if (!nodes.some(node => !isThemeUi(elementOf(node)))) continue;
          colors.invalidate(target, false);
          if (!record.addedNodes.length && ((!target.children.length && target.textContent.trim()) || target.matches(TEXT_SELECTORS.join(',')))) roots.add(target);
          for (const node of nodes) {
            if (node.nodeType !== Node.ELEMENT_NODE || isThemeUi(node)) continue;
            classify(node, true);
          }
          for (const node of record.addedNodes) {
            const element = elementOf(node);
            if (isThemeUi(element) || !element.isConnected) continue;
            colors.invalidate(element);
            roots.add(element);
            for (const message of elementsWithin(element, '.ml-item')) addedMessages.add(message);
          }
        } else {
          if (record.type === 'characterData' || ['style', 'class', 'id'].includes(record.attributeName)) colors.invalidate(target);
          roots.add(target);
        }
        classify(target, false, contentChanged);
      }
      if (messageLayoutDirty) {
        messageLayoutDirty = false;
        // Set row geometry before native ResizeObservers measure a newly
        // mounted virtual window. Color and decoration work stays in rAF.
        prepareMessageLayout(topLevelRoots([...roots].map(root => root.closest('.ml-item') || root)));
        messageLayoutPrepared = true;
        observer.takeRecords();
      }
      if (childRecords.length) {
        try { llHandleAdded(childRecords); } catch (e) {}
        try { llMembersArrived(childRecords); } catch (e) {}
      }
      if (roots.size || work.size) schedule();
    });
    const resize = new ResizeObserver(() => onGeometry());
    function bindGeometry() {
      const next = ['.chat-input-area', '.msg-input', '.chat-msg-area']
        .map(selector => document.querySelector(selector))
        .filter(Boolean);
      if (next.length === measured.length && next.every((element, i) => element === measured[i]))
        return;
      resize.disconnect();
      measured = next;
      for (const element of measured) resize.observe(element);
    }
    function flush() {
      frame = 0;
      if (disposed) return;
      if (document.hidden) {
        deferHidden();
        return;
      }
      flushing = true;
      const pending = new Set(work);
      work.clear();
      const changed = topLevelRoots([...roots]);
      roots.clear();
      const added = [...addedMessages];
      addedMessages.clear();
      const prepared = messageLayoutPrepared;
      messageLayoutPrepared = false;
      try {
        // Touch only changed subtrees; discard our own synchronous DOM writes below.
        colors.batch(() => {
          for (const root of changed) {
            applyOverrides(root);
            fixContrast(root);
            normalizeColors(root);
          }
        }, pending.has('structure'));
        if (pending.has('structure')) {
          bindGeometry();
          ensureHoverEntries();
          llWatchContactList();
          // 会话列表重建 / 切换账号后要把分组重新挂上；scope 不是 main 时
          // llApplyPinGroups 会自己 clear。
          llApplyPinGroups();
          pending.add('layout');
          pending.add('geometry');
        }
        if (pending.has('layout')) {
          mountSettingsEntry();
          llLayoutPass();
          keepWindowControlsVisible();
        }
        if (pending.has('messages')) {
          // A text or attribute mutation still needs its containing message processed.
          liuliMessagePass(topLevelRoots(changed.map(root => root.closest('.ml-item') || root)), prepared);
          llMotionPass(added);
        }
        if (pending.has('members')) llGroupMembersPass();
        else if (pending.has('messages')) llGroupRecentPass();
        if (pending.has('geometry') || pending.has('layout')) {
          syncBubbleWidth();
          mountInputBar();
          scheduleStick();
        }
      } finally {
        observer.takeRecords();
        flushing = false;
      }
    }
    function refreshPage() {
      if (disposed) return;
      colors.invalidate(document.body);
      roots.add(document.body);
      for (const kind of ['structure', 'messages', 'members']) work.add(kind);
      schedule();
    }
    function onGeometry() {
      if (flushing || disposed) return;
      work.add('geometry');
      schedule();
    }
    refreshInputGeometry = onGeometry;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style', 'aria-label', 'data-element-id', 'id', 'data-index']
    });
    function onVisibility() {
      if (document.hidden) deferHidden();
      else if (needsRefresh) {
        needsRefresh = false;
        refreshPage();
      }
    }
    function onStorage(event) {
      if (disposed) return;
      if (event.key === LL_MD_KEY) {
        roots.add(document.body);
        work.add('messages');
        schedule();
      }
    }
    function onLoad(event) {
      if (!disposed && event.target instanceof Element && event.target.closest('.chat-msg-area'))
        scheduleStick();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('liuli-scope', refreshPage);
    window.addEventListener('resize', onGeometry);
    window.addEventListener('storage', onStorage);
    document.addEventListener('load', onLoad, true);
    const api = {
      refresh: refreshPage,
      dispose() {
        if (disposed) return;
        disposed = true;
        observer.disconnect();
        resize.disconnect();
        colors.dispose();
        if (llColorRepair === colors) llColorRepair = null;
        cancelAnimationFrame(frame);
        frame = 0;
        roots.clear();
        work.clear();
        addedMessages.clear();
        measured = [];
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('liuli-scope', refreshPage);
        window.removeEventListener('resize', onGeometry);
        window.removeEventListener('storage', onStorage);
        document.removeEventListener('load', onLoad, true);
        if (refreshInputGeometry === onGeometry) refreshInputGeometry = () => {};
        if (window.__liuliPageObserver === api) delete window.__liuliPageObserver;
      }
    };
    window.__liuliPageObserver = api;
    roots.add(document.body);
    for (const kind of ['structure', 'messages', 'members']) work.add(kind);
    flush();
  }
  function installRevealTracker() {
    if (window.__liuliReveal2) return;
    window.__liuliReveal2 = true;
    var EDGE = 8,
      PAD = 18,
      CORNER = 200;
    /* #32.4a：顶部唤出区不能只有窗口顶边 8px（--ll-dock-gap）。胶囊本体是
     * top:6px + height:30px，按钮 34×26 的点击面从 y≈8 才开始——只认 y≤8 时
     * 「光标已经在按钮上」反而唤不出来、点下去也没反应，用户必须再往下摸一次才行。
     * 这里把顶部感应带放宽到胶囊底边（≈36px）；左边缘（导航）仍只用 EDGE，不受影响。 */
    var TOP_EDGE = 36,
      topEdgeCache = 0;
    function topEdge() {
      if (topEdgeCache) return topEdgeCache;
      var v = TOP_EDGE;
      try {
        var el =
          document.querySelector('.topbar-profile') || document.querySelector('.window-control-area');
        if (el) {
          var t = parseFloat(getComputedStyle(el).top);
          var hh = el.offsetHeight || 0;
          if (isFinite(t) && hh > 0) v = Math.max(v, t + hh); // top + height = 胶囊底边
        }
        var band = document.getElementById('liuli-top-hint-l');
        if (band) {
          var bh = band.getBoundingClientRect().height;
          if (bh > 0) v = Math.max(v, bh); // CSS 若把感应条加高，跟着它走
        }
      } catch (e) {}
      topEdgeCache = Math.max(EDGE, Math.min(64, v)); // 夹一层上限，CSS 改坏了也不至于整屏都算顶边
      return topEdgeCache;
    }
    var HOLD = {
      nav: 250,
      l: 600,
      r: 600
    };
    var KEYS = {
      l: 'liuliRL',
      r: 'liuliRR',
      nav: 'liuliRNav'
    };
    var state = {},
      timers = {},
      last = {
        x: -1,
        y: -1
      };
    function navPinned() {
      return document.body.dataset.liuliNavPin === '1';
    }
    function dropNav() {
      if (timers.nav) {
        clearTimeout(timers.nav);
        timers.nav = 0;
      }
      if (!state.nav && !document.body.dataset.liuliRNav) return;
      state.nav = false;
      delete document.body.dataset.liuliRNav;
    }
    function set(k, on, hold) {
      if (k === 'nav' && navPinned()) {
        dropNav();
        return;
      }
      if (on) {
        if (timers[k]) {
          clearTimeout(timers[k]);
          timers[k] = 0;
        }
        if (!state[k]) {
          state[k] = true;
          document.body.dataset[KEYS[k]] = '1';
        }
      } else if (state[k] && !timers[k]) {
        timers[k] = setTimeout(function () {
          timers[k] = 0;
          state[k] = false;
          delete document.body.dataset[KEYS[k]];
          if (k === 'nav') releaseNavFocus();
        }, hold || HOLD[k]);
      }
    }
    function releaseNavFocus() {
      try {
        var sb = document.querySelector('.container-sidebar');
        var a = document.activeElement;
        if (sb && a && a !== document.body && sb.contains(a) && !a.matches(':focus-visible'))
          a.blur();
      } catch (e) {}
    }
    function over(sel, x, y, pad = PAD) {
      var el = document.querySelector(sel);
      if (!el) return false;
      var r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        x >= r.left - pad &&
        x <= r.right + pad &&
        y >= r.top - pad &&
        y <= r.bottom + pad
      );
    }
    function nativeBar() {
      return document.body.dataset.liuliTb === 'native';
    }
    function efficiencyMode() {
      return !!document.querySelector('.global-container.container--wide');
    }
    function clearClassicReveal() {
      if (efficiencyMode()) return;
      for (const key of ['nav', 'l', 'r']) {
        clearTimeout(timers[key]);
        timers[key] = 0;
        state[key] = false;
        delete document.body.dataset[KEYS[key]];
      }
      topEdgeCache = 0;
    }
    const modeObserver = new MutationObserver(clearClassicReveal);
    const modeRoot = document.querySelector('.global-container');
    if (modeRoot) modeObserver.observe(modeRoot, { attributes: true, attributeFilter: ['class'] });
    clearClassicReveal();
    function onMove(e) {
      if (!efficiencyMode()) { clearClassicReveal(); return; }
      var x = e.clientX,
        y = e.clientY;
      last.x = x;
      last.y = y;
      set('nav', x <= EDGE || (state.nav && over('.container-sidebar', x, y)));
      if (nativeBar()) {
        set('l', false);
        set('r', false);
        return;
      }
      // #32.4a：顶部按胶囊底边算（≈36px），不再只认窗口顶边 8px
      var top = topEdge();
      set(
        'l',
        (y <= top && x >= 56 && x <= CORNER + 56) || (state.l && over('.topbar-profile', x, y))
      );
      set(
        'r',
        over('#liuli-top-hint-r', x, y, 0) ||
          (y <= top && x >= window.innerWidth - CORNER) ||
          (state.r && over('.window-control-area', x, y))
      );
    }
    function onLeave() {
      set('nav', false);
      ['l', 'r'].forEach(function (k) {
        var sel = k === 'l' ? '.topbar-profile' : '.window-control-area';
        set(k, false, state[k] && over(sel, last.x, last.y) ? 1500 : HOLD[k]);
      });
    }
    function onBlur() {
      set('nav', false);
      set('l', false);
      set('r', false);
    }
    document.addEventListener('mousemove', onMove, true);
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onBlur);
  }
  function syncCtlShield() {
    try {
      var shield = document.getElementById('liuli-ctl-shield');
      if (!shield) return;
      if (document.body.dataset.liuliScope !== 'main' || document.body.dataset.liuliTb === 'native' ||
          !document.querySelector('.global-container.container--wide')) {
        shield.style.display = 'none';
        return;
      }
      var area = document.querySelector('.window-title-bar .window-control-area:not(.window-title-bar__controls-left)');
      var r = area ? area.getBoundingClientRect() : null;
      if (!r || r.width < 1 || r.height < 1) {
        if (shield.style.display !== 'none') shield.style.display = 'none';
        return;
      }
      var css = 'display:block;left:' + Math.round(r.left) + 'px;top:' + Math.round(r.top) + 'px;width:' +
        Math.round(r.width) + 'px;height:' + Math.round(r.height) + 'px;';
      if (shield.style.cssText !== css) shield.style.cssText = css;
    } catch (e) {}
  }
  function ensureHoverEntries() {
    try {
      installRevealTracker();
      [
        ['liuli-top-hint-l', '唤出个人信息'],
        ['liuli-top-hint-r', '唤出窗口按钮']
      ].forEach(function (pair) {
        if (document.getElementById(pair[0])) return;
        var el = document.createElement('div');
        el.id = pair[0];
        el.className = 'liuli-top-hint';
        el.title = pair[1];
        document.body.appendChild(el);
      });
      // #60：窗口按钮胶囊盖在聊天标题栏上方，标题栏是拖动区（-webkit-app-region: drag）。
      // Chromium 按文档顺序合并拖动区，聊天标题栏在 DOM 里排在窗口标题栏后面，它的 drag
      // 会把胶囊的 no-drag 盖掉，系统把按钮上半截当成标题栏（HTCAPTION），点不到；
      // 只有标题栏自己的按钮（no-drag）那一条能点。这里在 body 末尾放一块透明的 no-drag
      // 遮罩，排在最后，按钮区域就一定是可点击的客户区。遮罩不接收鼠标事件。
      if (!document.getElementById('liuli-ctl-shield')) {
        var shield = document.createElement('div');
        shield.id = 'liuli-ctl-shield';
        shield.setAttribute('aria-hidden', 'true');
        document.body.appendChild(shield);
        window.addEventListener('resize', syncCtlShield);
      }
      syncCtlShield();
      if (!document.getElementById('liuli-nav-handle')) {
        var h = document.createElement('div');
        h.id = 'liuli-nav-handle';
        h.title = '展开导航';
        h.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';
        document.body.appendChild(h);
      }
    } catch (e) {}
  }
  function markQuoteRoots(root) {
    try {
      var all = elementsWithin(
        root,
        '.chat-msg-area :is([class*="reply"], [class*="quote"]):not([data-liuli-quote-root])'
      );
      for (var i = 0; i < all.length; i++) {
        if (all[i].dataset.liuliQuoteRoot !== '0') all[i].dataset.liuliQuoteRoot = '0';
      }
      var roots = elementsWithin(root, '.reply-element');
      var stale = elementsWithin(root, '[data-liuli-quote-root="1"]:not(.reply-element)');
      for (var s = 0; s < stale.length; s++) stale[s].dataset.liuliQuoteRoot = '0';
      for (var j = 0; j < roots.length; j++) {
        if (roots[j].dataset.liuliQuoteRoot !== '1') roots[j].dataset.liuliQuoteRoot = '1';
      }
    } catch (e) {}
  }
  const LL_WALLPAPER_KEY = 'liuli-dsh-wallpaper';
  const LL_WALLPAPER_REV_KEY = 'liuli-dsh-wallpaper-rev';
  function llErrText(e) {
    if (!e) return '';
    try {
      const name = e.name ? String(e.name) : '';
      const msg = e.message != null ? String(e.message) : String(e);
      return name && name !== 'Error' && msg.indexOf(name) !== 0 ? name + ': ' + msg : msg;
    } catch (err) {
      return '[unprintable error]';
    }
  }
  function llScopeName() {
    try {
      return (
        (document.body && document.body.dataset && document.body.dataset.liuliScope) || 'unknown'
      );
    } catch (e) {
      return 'unknown';
    }
  }
  function llWallpaperRev() {
    try {
      return localStorage.getItem(LL_WALLPAPER_REV_KEY) || '';
    } catch (e) {
      return '';
    }
  }
  function llFmtBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(2) + 'MB';
    if (v >= 1024) return (v / 1024).toFixed(1) + 'KB';
    return v + 'B';
  }
  const LL_WP_DEFAULTS = {
    src: null,
    area: null,
    fit: 'cover'
  };
  function loadWallpaperState() {
    try {
      const raw = localStorage.getItem(LL_WALLPAPER_KEY);
      if (!raw) return Object.assign({}, LL_WP_DEFAULTS);
      const parsed =
        raw.charAt(0) === '{'
          ? JSON.parse(raw)
          : {
              src: raw
            };
      const st = Object.assign({}, LL_WP_DEFAULTS, parsed);
      if (!st.area || typeof st.area.w !== 'number') st.area = null;
      return st;
    } catch (e) {
      return Object.assign({}, LL_WP_DEFAULTS);
    }
  }
  function saveWallpaperState(state, broadcast) {
    let ok = false;
    let error = '';
    let valueLen = 0;
    let revOk = false;
    let revError = '';
    try {
      const raw = JSON.stringify(state);
      valueLen = raw.length;
      localStorage.setItem(LL_WALLPAPER_KEY, raw);
      ok = true;
    } catch (e) {
      error = llErrText(e);
    }
    if (ok) {
      try {
        localStorage.setItem(LL_WALLPAPER_REV_KEY, String(Date.now()));
        revOk = true;
      } catch (e) {
        revError = llErrText(e);
      }
    }
    auditWallpaper('persist', {
      ok: ok,
      error: error,
      key: LL_WALLPAPER_KEY,
      valueLen: valueLen,
      revOk: revOk,
      revError: revError
    });
    if (broadcast !== false) {
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
    }
    return {
      ok: ok,
      error: error
    };
  }
  function getImageRatio(src) {
    return imageMetadata.get(src)?.ratio || null;
  }
  setImageRatioReader(getImageRatio);
  async function primeImageRatio(src) {
    if (getImageRatio(src)) return getImageRatio(src);
    try {
      return (await readImageMetadata(src)).ratio;
    } catch {
      return null;
    }
  }
  function normalizeAreaToRatio(area, ratio) {
    const safeRatio = Math.max(0.05, Math.min(20, ratio));
    const areaSize = Math.max(area.w * area.h, 0.04 * 0.04);
    let w = Math.sqrt(areaSize * safeRatio);
    let h = Math.sqrt(areaSize / safeRatio);
    const scale = Math.min(1, 1 / w, 1 / h);
    w *= scale;
    h *= scale;
    const maxDim = Math.max(w, h);
    if (maxDim > 0.998) {
      const shrink = 0.998 / maxDim;
      w *= shrink;
      h *= shrink;
    }
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    return {
      x: Math.min(1 - w, Math.max(0, cx - w / 2)),
      y: Math.min(1 - h, Math.max(0, cy - h / 2)),
      w: w,
      h: h
    };
  }
  function bgGeometry(area, imageRatio, viewportRatio) {
    if (arguments[3] === 'contain')
      return {
        size: 'contain',
        position: 'center'
      };
    if (arguments[3] === 'stretch')
      return {
        size: '100% 100%',
        position: 'center'
      };
    if (!area || area.w <= 0.04 || area.h <= 0.04) {
      return {
        size: 'cover',
        position: 'center'
      };
    }
    const vRatio =
      viewportRatio && viewportRatio > 0 ? viewportRatio : window.innerWidth / window.innerHeight;
    const iRatio = imageRatio && imageRatio > 0 ? imageRatio : vRatio;
    const n = normalizeAreaToRatio(area, vRatio / iRatio);
    if (n.w >= 0.999 || n.h >= 0.999) {
      return {
        size: 'cover',
        position: 'center'
      };
    }
    const px = Math.min(1, Math.max(0, n.x / (1 - n.w)));
    const py = Math.min(1, Math.max(0, n.y / (1 - n.h)));
    return {
      size: 'calc(100% / ' + n.w + ') calc(100% / ' + n.h + ')',
      position: (px * 100).toFixed(2) + '% ' + (py * 100).toFixed(2) + '%'
    };
  }
  function ensureWallpaperStyle() {
    let el = document.getElementById('liuli-wallpaper-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'liuli-wallpaper-style';
      document.head.appendChild(el);
    }
    return el;
  }
  function renderWallpaper(state, reason) {
    const el = ensureWallpaperStyle();
    llWpLast = state;
    if (window.LiuliVideoWallpaper) {
      window.LiuliVideoWallpaper.apply(state).catch(error => {
        console.warn('[theme] video wallpaper:', error && error.message);
        toast('视频壁纸无法播放，暂时显示首帧：' + llErrText(error));
      });
    }
    /* #49 / #52：通话、屏幕共享窗口是原生视频层，迷你窗是透明窗口，
     * 铺壁纸会把原生画面盖住；CSS 侧还有 content:none 双保险。 */
    if (
      document.body.dataset.liuliAv === '1' ||
      (location.hash || '').indexOf('#/mini-fishing') === 0
    ) {
      el.textContent = '';
      return;
    }
    if (!state || !state.src) {
      el.textContent = '';
      if (reason) {
        auditWallpaper('apply', {
          scope: llScopeName(),
          styleLen: 0,
          ratioKnown: false,
          fit: (state && state.fit) || 'cover',
          area: null,
          cleared: true,
          reason: reason,
          rev: llWallpaperRev()
        });
      }
      return;
    }
    const g = bgGeometry(
      state.area,
      getImageRatio(state.src),
      window.innerWidth / window.innerHeight,
      state.fit || 'cover'
    );
    el.textContent =
      '#app::before {' +
      '  content: "" !important; position: absolute !important; inset: 0 !important;' +
      '  z-index: 0 !important; pointer-events: none !important;' +
      '  background-image: linear-gradient(rgba(var(--ll-veil-rgb, var(--ll-scrim-rgb)), var(--ll-wallpaper-dim, 0.18)),' +
      '    rgba(var(--ll-veil-rgb, var(--ll-scrim-rgb)), var(--ll-wallpaper-dim, 0.18))),\n' +
      '    url("' +
      state.src +
      '") !important;' +
      '  background-position: ' +
      g.position +
      ' !important;' +
      '  background-size: ' +
      g.size +
      ' !important;' +
      '  background-repeat: no-repeat !important;' +
      '}';
    if (reason) {
      auditWallpaper('apply', {
        scope: llScopeName(),
        styleLen: el.textContent.length,
        ratioKnown: !!getImageRatio(state.src),
        fit: state.fit || 'cover',
        area: state.area || null,
        reason: reason,
        rev: llWallpaperRev()
      });
    }
  }
  let llWpLast = null;
  let llWpResizeRaf = 0;
  try {
    window.addEventListener('resize', function () {
      if (llWpResizeRaf || !llWpLast || !llWpLast.src) return;
      llWpResizeRaf = requestAnimationFrame(function () {
        llWpResizeRaf = 0;
        renderWallpaper(llWpLast);
      });
    });
  } catch (e) {}
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== LL_WALLPAPER_KEY) return;
      const st = loadWallpaperState();
      auditWallpaper('storage', {
        scope: llScopeName(),
        key: LL_WALLPAPER_KEY,
        hasSrc: !!(st && st.src)
      });
      if (st.src && !getImageRatio(st.src)) {
        primeImageRatio(st.src).then(function (ratio) {
          if (!ratio || loadWallpaperState().src !== st.src) return;
          renderWallpaper(loadWallpaperState(), 'storage');
          refreshWallpaperPreview();
        });
      }
      renderWallpaper(st, 'storage');
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
      if (typeof refreshWallpaperPreview === 'function') refreshWallpaperPreview();
    });
  } catch (e) {}
  const LL_WP_DATAURL_BUDGET = 3.5 * 1024 * 1024;
  const LL_WP_ENCODE_WIDTHS = [2560, 1920, 1440, 1080];
  const LL_WP_ENCODE_QUALITIES = [0.86, 0.8];
  function llReadFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('读取文件失败'));
      };
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.readAsDataURL(file);
    });
  }
  function llDecodeImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onerror = function () {
        reject(new Error('图片解码失败'));
      };
      img.onload = function () {
        resolve(img);
      };
      img.src = src;
    });
  }
  async function readImageFile(file, maxW) {
    const started = Date.now();
    try {
      const raw = await llReadFileAsDataUrl(file);
      const img = await llDecodeImage(raw);
      const cap = Number(maxW) > 0 ? Number(maxW) : LL_WP_ENCODE_WIDTHS[0];
      const widths = [];
      if (img.naturalWidth > 0 && img.naturalWidth <= cap) widths.push(img.naturalWidth);
      for (const w of LL_WP_ENCODE_WIDTHS) {
        if (w <= cap && widths.indexOf(w) < 0) widths.push(w);
      }
      if (!widths.length) widths.push(cap);
      const tries = [];
      let last = null;
      let prevDims = '';
      for (const targetW of widths) {
        const sc = Math.min(1, targetW / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * sc));
        const h = Math.max(1, Math.round(img.naturalHeight * sc));
        const dims = w + 'x' + h;
        if (dims === prevDims) continue;
        prevDims = dims;
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext('2d');
        if (!ctx) throw new Error('canvas 2d 不可用');
        ctx.drawImage(img, 0, 0, w, h);
        for (const q of LL_WP_ENCODE_QUALITIES) {
          const dataUrl = cvs.toDataURL('image/jpeg', q);
          tries.push({
            w: w,
            q: q,
            len: dataUrl.length
          });
          last = {
            dataUrl: dataUrl,
            ratio: w / h,
            width: w,
            height: h,
            quality: q
          };
          if (dataUrl.length <= LL_WP_DATAURL_BUDGET) {
            auditWallpaper('encode', {
              ok: true,
              dataUrlLen: dataUrl.length,
              width: w,
              height: h,
              quality: q,
              ms: Date.now() - started,
              tries: tries
            });
            return last;
          }
        }
      }
      if (!last) throw new Error('没有可用的编码结果');
      const over = last.dataUrl.length > LL_WP_DATAURL_BUDGET;
      auditWallpaper('encode', {
        ok: true,
        dataUrlLen: last.dataUrl.length,
        width: last.width,
        height: last.height,
        quality: last.quality,
        ms: Date.now() - started,
        over: over,
        tries: tries
      });
      return Object.assign(
        {
          over: over
        },
        last
      );
    } catch (e) {
      auditWallpaper('encode', {
        ok: false,
        error: llErrText(e),
        ms: Date.now() - started
      });
      throw e;
    }
  }
  let llWpRefresh = null;
  function refreshWallpaperPreview() {
    if (llWpRefresh) llWpRefresh();
  }
  const LL_WP_FITS = [
    ['cover', '填充（Cover）'],
    ['contain', '适应（Contain）'],
    ['stretch', '拉伸（Stretch）']
  ];
  function llBtn(text, variant) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'liuli-btn liuli-btn--' + (variant || 'ghost');
    b.textContent = text;
    return b;
  }
  function llApplyWallpaper(st) {
    const saved = saveWallpaperState(st, true);
    if (st && st.src && !getImageRatio(st.src)) {
      primeImageRatio(st.src).then(function (ratio) {
        if (!ratio || loadWallpaperState().src !== st.src) return;
        renderWallpaper(loadWallpaperState(), 'user');
        refreshWallpaperPreview();
      });
    }
    renderWallpaper(st, 'user');
    refreshWallpaperPreview();
    if (!saved.ok) {
      toast('壁纸保存失败：' + saved.error + '（仅本次生效，重启后可能丢失）');
    }
    return saved;
  }
  const LL_MAIN_VP_KEY = 'liuli-dsh-main-viewport';
  function llMainViewportRatio() {
    if (document.body && document.body.dataset.liuliScope === 'main')
      return window.innerWidth / window.innerHeight;
    try {
      const v = JSON.parse(localStorage.getItem(LL_MAIN_VP_KEY) || 'null');
      if (v && v.w > 0 && v.h > 0) return v.w / v.h;
    } catch (e) {}
    return window.innerWidth / window.innerHeight;
  }
  (function publishMainViewport() {
    let frame = 0;
    function publish() {
      frame = 0;
      if (document.body.dataset.liuliScope !== 'main') return;
      try {
        const current = JSON.parse(localStorage.getItem(LL_MAIN_VP_KEY) || 'null');
        if (current?.w === innerWidth && current?.h === innerHeight) return;
        localStorage.setItem(LL_MAIN_VP_KEY, JSON.stringify({ w: innerWidth, h: innerHeight }));
        refreshWallpaperPreview();
      } catch (error) {
        console.warn('[theme] viewport save failed', error);
      }
    }
    window.addEventListener('resize', () => {
      if (!frame) frame = requestAnimationFrame(publish);
    });
    window.addEventListener('liuli-scope', publish);
    window.addEventListener('storage', event => {
      if (event.key === LL_MAIN_VP_KEY) refreshWallpaperPreview();
    });
    publish();
  })();
  function buildWallpaperControls(host) {
    const block = document.createElement('div');
    block.className = 'liuli-wp-block';
    host.appendChild(block);
    const title = document.createElement('div');
    title.className = 'liuli-wp-title';
    title.textContent = '壁纸设置';
    block.appendChild(title);
    const row = document.createElement('div');
    row.className = 'liuli-wp-actions';
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = 'image/*,video/mp4,video/webm,.mp4,.webm';
    pick.style.display = 'none';
    const chooseBtn = llBtn('选择图片或视频', 'primary');
    chooseBtn.addEventListener('click', function () {
      pick.click();
    });
    const fileName = document.createElement('span');
    fileName.className = 'liuli-wp-filename';
    const removeBtn = llBtn('移除', 'ghost');
    removeBtn.addEventListener('click', function () {
      let ok = true;
      let error = '';
      const oldVideo = loadWallpaperState().videoId;
      try {
        localStorage.removeItem(LL_WALLPAPER_KEY);
        localStorage.setItem(LL_WALLPAPER_REV_KEY, String(Date.now()));
      } catch (e) {
        ok = false;
        error = llErrText(e);
      }
      auditWallpaper('remove', {
        ok: ok,
        error: error
      });
      if (ok && oldVideo && window.LiuliVideoWallpaper) {
        window.LiuliVideoWallpaper.remove(oldVideo).catch(console.warn);
      }
      renderWallpaper(null, 'remove');
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
      fileName.textContent = '';
      refreshWallpaperPreview();
      toast(ok ? '已恢复默认壁纸' : '移除壁纸失败：' + error);
    });
    pick.addEventListener('change', function () {
      const f = pick.files && pick.files[0];
      if (!f) return;
      auditWallpaper('pick', {
        file: {
          name: String(f.name || ''),
          size: Number(f.size) || 0,
          type: String(f.type || '')
        },
        maxW: 2560
      });
      chooseBtn.disabled = true;
      chooseBtn.textContent = '读取中…';
      const videoFile = /^video\//i.test(f.type) || /\.(mp4|webm)$/i.test(f.name);
      const previousVideo = loadWallpaperState().videoId;
      const reading = videoFile
        ? window.LiuliVideoWallpaper.importFile(f).then(result => ({
            dataUrl: result.poster, ratio: result.width / result.height,
            videoId: result.id, name: result.name, kind: 'video'
          }))
        : readImageFile(f, 2560);
      reading
        .then(function (r) {
          rememberImage(r.dataUrl, { ratio: r.ratio });
          const prev = loadWallpaperState();
          const saved = llApplyWallpaper({
            src: r.dataUrl,
            area: null,
            fit: prev.fit || 'cover',
            kind: r.kind || 'image',
            videoId: r.videoId || null,
            name: String(f.name || '')
          });
          if (saved.ok && previousVideo && previousVideo !== r.videoId) {
            window.LiuliVideoWallpaper.remove(previousVideo).catch(console.warn);
          } else if (!saved.ok && r.videoId) {
            window.LiuliVideoWallpaper.remove(r.videoId).catch(console.warn);
            renderWallpaper(prev, 'video-save-failed');
            return;
          }
          fileName.textContent = f.name;
          if (r.over) {
            toast(
              '壁纸已更新，但压到最小仍约 ' +
                llFmtBytes(r.dataUrl.length) +
                '，若显示异常请换一张更小的图'
            );
          } else {
            toast('壁纸已更新，主题色已按新壁纸取色');
          }
          if (llModeAdviceRefresh) llModeAdviceRefresh();
        })
        .catch(function (e) {
          toast('读取失败：' + llErrText(e));
        })
        .finally(function () {
          chooseBtn.disabled = false;
          chooseBtn.textContent = '选择图片或视频';
          pick.value = '';
        });
    });
    row.appendChild(chooseBtn);
    row.appendChild(removeBtn);
    row.appendChild(fileName);
    row.appendChild(pick);
    block.appendChild(row);
    const advice = document.createElement('div');
    advice.className = 'liuli-wp-advice';
    advice.hidden = true;
    block.appendChild(advice);
    llModeAdviceRefresh = function () {
      return llCheckModeAdvice(advice);
    };
    llModeAdviceRefresh();
    const fitRow = document.createElement('div');
    fitRow.className = 'liuli-wp-fit';
    const fitLabel = document.createElement('span');
    fitLabel.textContent = '适应模式';
    const fitSeg = document.createElement('div');
    fitSeg.className = 'liuli-seg';
    fitRow.appendChild(fitLabel);
    fitRow.appendChild(fitSeg);
    block.appendChild(fitRow);
    const fitBtns = {};
    LL_WP_FITS.forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function () {
        const st = loadWallpaperState();
        st.fit = p[0];
        llApplyWallpaper(st);
      });
      fitSeg.appendChild(b);
      fitBtns[p[0]] = b;
    });
    const previewActions = document.createElement('div');
    previewActions.className = 'liuli-wp-actions';
    const previewHost = document.createElement('div');
    previewHost.className = 'liuli-wp-preview-host';
    const note = document.createElement('div');
    note.className = 'liuli-wp-note';
    note.textContent = '选区仅 Cover 模式生效';
    block.appendChild(previewActions);
    block.appendChild(previewHost);
    block.appendChild(note);
    let selectMode = false;
    let selBox = null;
    let drag = null;
    let stage = null;
    const winRatio = llMainViewportRatio;
    const clamp = function (v, a, b) {
      return Math.min(b, Math.max(a, v));
    };
    const cropRatioOf = function (ir) {
      return ir && ir > 0 ? winRatio() / ir : 1;
    };
    function windowArea(ir) {
      if (!ir || ir <= 0) return null;
      const wr = winRatio();
      const maxW = Math.min(0.998, ir > wr ? wr / ir : 1);
      const maxH = Math.min(0.998, ir > wr ? 1 : ir / wr);
      return {
        x: (1 - maxW) / 2,
        y: (1 - maxH) / 2,
        w: maxW,
        h: maxH
      };
    }
    function createArea(start, p, ratio) {
      const r = Math.max(0.05, Math.min(20, ratio));
      const dx = p.x - start.x,
        dy = p.y - start.y;
      const dirX = dx >= 0 ? 1 : -1,
        dirY = dy >= 0 ? 1 : -1;
      const maxW = dirX > 0 ? 1 - start.x : start.x;
      const maxH = dirY > 0 ? 1 - start.y : start.y;
      const w = Math.min(Math.max(Math.abs(dx), Math.abs(dy) * r), maxW, maxH * r);
      const h = w / r;
      return {
        x: dirX > 0 ? start.x : start.x - w,
        y: dirY > 0 ? start.y : start.y - h,
        w: w,
        h: h
      };
    }
    function resizeArea(box, corner, p, ratio) {
      const r = Math.max(0.05, Math.min(20, ratio));
      const fx = corner === 'tl' || corner === 'bl' ? box.x + box.w : box.x;
      const fy = corner === 'tl' || corner === 'tr' ? box.y + box.h : box.y;
      const dirX = corner === 'tr' || corner === 'br' ? 1 : -1;
      const dirY = corner === 'bl' || corner === 'br' ? 1 : -1;
      const maxW = dirX > 0 ? 1 - fx : fx;
      const maxH = dirY > 0 ? 1 - fy : fy;
      const w = Math.min(Math.max(Math.abs(p.x - fx), Math.abs(p.y - fy) * r), maxW, maxH * r);
      const h = w / r;
      return {
        x: dirX > 0 ? fx : fx - w,
        y: dirY > 0 ? fy : fy - h,
        w: w,
        h: h
      };
    }
    function norm(e) {
      if (!stage) return null;
      const r = stage.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return {
        x: clamp((e.clientX - r.left) / r.width, 0, 1),
        y: clamp((e.clientY - r.top) / r.height, 0, 1)
      };
    }
    function cropBoxEl(box, interactive) {
      const el = document.createElement('div');
      el.className = 'liuli-wp-crop' + (interactive ? '' : ' liuli-wp-crop--static');
      el.style.left = box.x * 100 + '%';
      el.style.top = box.y * 100 + '%';
      el.style.width = box.w * 100 + '%';
      el.style.height = box.h * 100 + '%';
      if (interactive) {
        ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
          const h = document.createElement('span');
          h.className = 'liuli-wp-handle liuli-wp-handle--' + c;
          el.appendChild(h);
        });
      }
      return el;
    }
    function paintSelection() {
      if (!stage) return;
      const old = stage.querySelector('.liuli-wp-crop');
      if (old) old.remove();
      if (selBox && selBox.w > 0) stage.appendChild(cropBoxEl(selBox, true));
    }
    function render() {
      const st = loadWallpaperState();
      const fit = st.fit || 'cover';
      Object.keys(fitBtns).forEach(function (k) {
        fitBtns[k].classList.toggle('is-active', k === fit);
      });
      removeBtn.disabled = !st.src;
      fileName.textContent = st.name || '';
      previewActions.innerHTML = '';
      previewHost.innerHTML = '';
      stage = null;
      note.style.display = st.src && fit !== 'cover' ? '' : 'none';
      if (!st.src) {
        previewHost.style.display = 'none';
        previewActions.style.display = 'none';
        return;
      }
      previewHost.style.display = '';
      previewActions.style.display = '';
      const ir = getImageRatio(st.src);
      if (!ir) {
        primeImageRatio(st.src).then(ratio => {
          if (ratio && loadWallpaperState().src === st.src) render();
        });
      }
      const wr = winRatio();
      const width = 'min(100%, calc(220px * ' + wr + '))';
      const cr = cropRatioOf(ir);
      if (selectMode) {
        const reselect = llBtn('重新选择', 'ghost');
        reselect.addEventListener('click', function () {
          selBox = windowArea(ir);
          paintSelection();
        });
        const done = llBtn('完成选区', 'primary');
        done.addEventListener('click', function () {
          if (selBox && selBox.w > 0.04 && selBox.h > 0.04) {
            const cur = loadWallpaperState();
            cur.area = normalizeAreaToRatio(selBox, cr);
            llApplyWallpaper(cur);
          }
          selectMode = false;
          selBox = null;
          render();
        });
        previewActions.appendChild(reselect);
        previewActions.appendChild(done);
      } else {
        const edit = llBtn(st.area ? '编辑选区' : '重新选择', 'ghost');
        edit.disabled = st.kind === 'video' || fit !== 'cover' || !ir;
        edit.addEventListener('click', function () {
          const saved =
            st.area && st.area.w > 0.04 && st.area.h > 0.04
              ? normalizeAreaToRatio(st.area, cr)
              : null;
          selBox = saved || windowArea(ir);
          selectMode = true;
          render();
        });
        previewActions.appendChild(edit);
        if (st.area) {
          const clear = llBtn('清除选区', 'ghost');
          clear.addEventListener('click', function () {
            const cur = loadWallpaperState();
            cur.area = null;
            llApplyWallpaper(cur);
          });
          previewActions.appendChild(clear);
        }
      }
      const full = document.createElement('div');
      full.className = 'liuli-wp-full';
      full.style.backgroundImage = 'url("' + st.src + '")';
      if (selectMode && ir) {
        stage = document.createElement('div');
        stage.className = 'liuli-wp-context is-selecting';
        stage.style.width = width;
        stage.style.aspectRatio = String(ir);
        stage.appendChild(full);
        previewHost.appendChild(stage);
        paintSelection();
        stage.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          const r = stage.getBoundingClientRect();
          const p0 = norm(e);
          if (!p0) return;
          const box = selBox;
          if (box && box.w > 0) {
            const L = box.x * r.width,
              T = box.y * r.height;
            const R = (box.x + box.w) * r.width,
              B = (box.y + box.h) * r.height;
            const lx = e.clientX - r.left,
              ly = e.clientY - r.top;
            const dL = Math.abs(lx - L),
              dR = Math.abs(lx - R),
              dT = Math.abs(ly - T),
              dB = Math.abs(ly - B);
            const nearCorner = (dL < 12 || dR < 12) && (dT < 12 || dB < 12);
            const nearBox = lx >= L - 6 && lx <= R + 6 && ly >= T - 6 && ly <= B + 6;
            if (nearCorner) {
              drag = {
                mode: 'resize',
                box: box,
                corner: (dT <= dB ? 't' : 'b') + (dL <= dR ? 'l' : 'r')
              };
            } else if (nearBox) {
              drag = {
                mode: 'move',
                box: box,
                ox: clamp(p0.x - box.x, 0, box.w),
                oy: clamp(p0.y - box.y, 0, box.h)
              };
            } else {
              drag = {
                mode: 'create',
                start: p0,
                prev: box
              };
              selBox = {
                x: p0.x,
                y: p0.y,
                w: 0,
                h: 0
              };
            }
          } else {
            drag = {
              mode: 'create',
              start: p0,
              prev: box
            };
            selBox = {
              x: p0.x,
              y: p0.y,
              w: 0,
              h: 0
            };
          }
          stage.setPointerCapture(e.pointerId);
          paintSelection();
        });
        stage.addEventListener('pointermove', function (e) {
          if (!drag) return;
          const p = norm(e);
          if (!p) return;
          if (drag.mode === 'create') selBox = createArea(drag.start, p, cr);
          else if (drag.mode === 'resize') selBox = resizeArea(drag.box, drag.corner, p, cr);
          else
            selBox = {
              x: clamp(p.x - drag.ox, 0, 1 - drag.box.w),
              y: clamp(p.y - drag.oy, 0, 1 - drag.box.h),
              w: drag.box.w,
              h: drag.box.h
            };
          paintSelection();
        });
        const up = function () {
          const d = drag;
          drag = null;
          if (d && d.mode === 'create' && !(selBox && selBox.w > 0.04 && selBox.h > 0.04)) {
            selBox = d.prev;
            paintSelection();
          }
        };
        stage.addEventListener('pointerup', up);
        stage.addEventListener('pointercancel', up);
      } else if (st.area && fit === 'cover' && ir) {
        stage = document.createElement('div');
        stage.className = 'liuli-wp-context';
        stage.style.width = width;
        stage.style.aspectRatio = String(ir);
        stage.appendChild(full);
        stage.appendChild(cropBoxEl(normalizeAreaToRatio(st.area, cr), false));
        previewHost.appendChild(stage);
      } else {
        stage = document.createElement('div');
        stage.className = 'liuli-wp-stage2';
        stage.style.width = width;
        stage.style.aspectRatio = String(wr);
        const fx = document.createElement('div');
        fx.className = 'liuli-wp-effect';
        const g = bgGeometry(st.area, ir, wr, fit);
        fx.style.backgroundImage = 'url("' + st.src + '")';
        fx.style.backgroundSize = g.size;
        fx.style.backgroundPosition = g.position;
        stage.appendChild(fx);
        previewHost.appendChild(stage);
      }
    }
    llWpRefresh = render;
    render();
  }
  const LL_MODE_KEY = 'liuli-dsh-mode';
  function llThemeMode() {
    try {
      const v = localStorage.getItem(LL_MODE_KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }
  function llIsDark() {
    const m = llThemeMode();
    if (m === 'light') return false;
    if (m === 'dark') return true;
    return (
      document.body.classList.contains('q-theme-tokens-dark') ||
      document.body.getAttribute('q-theme') === 'dark'
    );
  }
  function llApplyMode(withTransition, x, y) {
    const run = function () {
      const m = llThemeMode();
      if (m === 'auto') delete document.body.dataset.liuliMode;
      else document.body.dataset.liuliMode = m;
      document.body.dataset.liuliDark = llIsDark() ? '1' : '0';
      window.__liuliPaletteApplied = false;
      return applyDynamicPalette();
    };
    if (
      withTransition &&
      !motion.reduced &&
      !document.hidden &&
      typeof document.startViewTransition === 'function'
    ) {
      const root = document.documentElement;
      root.style.setProperty('--vt-x', (x || innerWidth / 2) + 'px');
      root.style.setProperty('--vt-y', (y || innerHeight / 2) + 'px');
      root.style.setProperty('--vt-r', Math.hypot(innerWidth, innerHeight) + 'px');
      document.startViewTransition(run);
    } else {
      run();
    }
  }
  try {
    window.addEventListener('storage', function (e) {
      if (e.key === LL_MODE_KEY) {
        llApplyMode(false);
        if (typeof llModeRefresh === 'function') llModeRefresh();
      }
      if (e.key === ROLE_KEY) {
        window.__liuliPaletteApplied = false;
        applyDynamicPalette();
      }
    });
  } catch (e) {}
  let llModeRefresh = null;
  try {
    new MutationObserver(function () {
      if (llThemeMode() !== 'auto') return;
      const d = llIsDark() ? '1' : '0';
      if (document.body.dataset.liuliDark !== d) llApplyMode(false);
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ['q-theme', 'class']
    });
  } catch (e) {}
  const LL_WP_ADVICE_KEY = 'liuli-wp-advice-dismissed';
  let llModeAdviceRefresh = null;
  const llSrgbToY = s => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
  const llYToSrgb = y => (y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
  const llLstarToY = l => (l > 8 ? Math.pow((l + 16) / 116, 3) : l / 903.3);
  function llWallpaperFingerprint(src) {
    return src ? src.length + ':' + src.slice(-48) : '';
  }
  async function llWallpaperLuma(src) {
    const img = await llDecodeImage(src);
    const n = 48;
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, n, n);
    const px = ctx.getImageData(0, 0, n, n).data;
    let sum = 0,
      cnt = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      sum +=
        0.2126 * llSrgbToY(px[i] / 255) +
        0.7152 * llSrgbToY(px[i + 1] / 255) +
        0.0722 * llSrgbToY(px[i + 2] / 255);
      cnt++;
    }
    return cnt ? sum / cnt : 0.5;
  }
  function llModeContrast(wallY, dim, opacity, dark, veil) {
    const veilSrgb = veil === 'light' ? llYToSrgb(llLstarToY(98)) : 0;
    const wall = llYToSrgb(wallY) * (1 - dim) + veilSrgb * dim;
    const glass = llYToSrgb(llLstarToY(dark ? 12 : 94));
    const bgY = llSrgbToY(glass * opacity + wall * (1 - opacity));
    const textY = llLstarToY(dark ? 90 : 10);
    return (Math.max(bgY, textY) + 0.05) / (Math.min(bgY, textY) + 0.05);
  }
  async function llCheckModeAdvice(box) {
    box.hidden = true;
    box.textContent = '';
    let src = null;
    try {
      const st = loadWallpaperState();
      src = st && st.src;
    } catch (e) {}
    if (!src) return null;
    const fp = llWallpaperFingerprint(src);
    const dark = llIsDark();
    try {
      if (localStorage.getItem(LL_WP_ADVICE_KEY) === fp + '|' + (dark ? 'dark' : 'light'))
        return null;
    } catch (e) {}
    let y;
    try {
      y = await llWallpaperLuma(src);
    } catch (e) {
      return null;
    }
    const cfg = llModeCfg || DEFAULT_SETTINGS;
    const op = Number(cfg.opacity);
    const o = isFinite(op) ? op : 0.5;
    const cur = llModeContrast(y, llDimFor(cfg, dark), o, dark, llVeilFor(cfg, dark));
    const alt = llModeContrast(y, llDimFor(cfg, !dark), o, !dark, llVeilFor(cfg, !dark));
    const result = {
      luma: y,
      current: cur,
      other: alt,
      advise: cur < 4.5 && alt >= cur * 1.5
    };
    if (!result.advise) return result;
    const target = dark ? 'light' : 'dark';
    const msg = document.createElement('div');
    msg.className = 'liuli-wp-advice__text';
    msg.textContent =
      (dark
        ? '这张壁纸偏亮，暗色主题下的浅色文字不够清楚'
        : '这张壁纸偏暗，亮色主题下的深色文字不够清楚') +
      '（估算对比度 ' +
      cur.toFixed(1) +
      ':1）。换成' +
      (dark ? '亮色' : '暗色') +
      '主题约 ' +
      alt.toFixed(1) +
      ':1。';
    const acts = document.createElement('div');
    acts.className = 'liuli-wp-actions';
    const go = llBtn('切换为' + (dark ? '亮色' : '暗色'), 'primary');
    go.addEventListener('click', function (e) {
      try {
        localStorage.setItem(LL_MODE_KEY, target);
      } catch (err) {}
      llApplyMode(true, e.clientX, e.clientY);
      if (typeof llModeRefresh === 'function') llModeRefresh();
      box.hidden = true;
    });
    const keep = llBtn('保持现状', 'ghost');
    keep.addEventListener('click', function () {
      try {
        localStorage.setItem(LL_WP_ADVICE_KEY, fp + '|' + (dark ? 'dark' : 'light'));
      } catch (err) {}
      box.hidden = true;
    });
    acts.appendChild(go);
    acts.appendChild(keep);
    box.appendChild(msg);
    box.appendChild(acts);
    box.hidden = false;
    return result;
  }
  window.__liuliModeAdvice = function () {
    const box = document.createElement('div');
    return llCheckModeAdvice(box).then(function (r) {
      return (
        r && {
          luma: +r.luma.toFixed(3),
          current: +r.current.toFixed(2),
          other: +r.other.toFixed(2),
          advise: r.advise
        }
      );
    });
  };
  function buildModeControls(host) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row';
    const label = document.createElement('span');
    label.textContent = '明暗主题';
    const seg = document.createElement('div');
    seg.className = 'liuli-seg';
    row.appendChild(label);
    row.appendChild(seg);
    host.appendChild(row);
    const btns = {};
    [
      ['auto', '跟随 QQ'],
      ['light', '亮色'],
      ['dark', '暗色']
    ].forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function (e) {
        try {
          if (p[0] === 'auto') localStorage.removeItem(LL_MODE_KEY);
          else localStorage.setItem(LL_MODE_KEY, p[0]);
        } catch (err) {}
        llApplyMode(true, e.clientX, e.clientY);
        refresh();
        if (llModeAdviceRefresh) llModeAdviceRefresh();
      });
      seg.appendChild(b);
      btns[p[0]] = b;
    });
    function refresh() {
      const m = llThemeMode();
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('is-active', k === m);
      });
    }
    llModeRefresh = refresh;
    refresh();
  }
  function buildDiagSection(host) {
    const block = document.createElement('div');
    block.className = 'liuli-wp-block liuli-diag';
    host.appendChild(block);
    const title = document.createElement('div');
    title.className = 'liuli-wp-title';
    title.textContent = '诊断';
    block.appendChild(title);
    const desc = document.createElement('div');
    desc.className = 'liuli-diag-desc';
    desc.textContent =
      '把运行环境、主题资源、日志、UI/壁纸状态打成 zip（不含聊天记录；设置层截图默认包含）。遇到启动报错、壁纸不显示或设置样式异常时，可导出后检查。';
    block.appendChild(desc);
    const checkRow = document.createElement('label');
    checkRow.className = 'liuli-diag-check';
    const shots = document.createElement('input');
    shots.type = 'checkbox';
    shots.checked = false;
    const shotsText = document.createElement('span');
    shotsText.textContent = '包含聊天窗口截图（可能包含当前聊天画面）';
    checkRow.appendChild(shots);
    checkRow.appendChild(shotsText);
    block.appendChild(checkRow);
    const shotsHint = document.createElement('div');
    shotsHint.className = 'liuli-diag-hint';
    shotsHint.textContent =
      '设置页截图默认包含（不含聊天内容）；聊天窗口与壁纸缩略图只在勾选后采集。';
    block.appendChild(shotsHint);
    const actions = document.createElement('div');
    actions.className = 'liuli-wp-actions';
    const exportBtn = llBtn('导出诊断包', 'primary');
    const openBtn = llBtn('打开文件夹', 'ghost');
    openBtn.disabled = true;
    actions.appendChild(exportBtn);
    actions.appendChild(openBtn);
    block.appendChild(actions);
    const status = document.createElement('div');
    status.className = 'liuli-diag-status';
    status.textContent = '状态：就绪';
    block.appendChild(status);
    const errRow = document.createElement('div');
    errRow.className = 'liuli-diag-errors';
    const errCount = document.createElement('span');
    errCount.textContent = '最近错误：0 条';
    const errToggle = document.createElement('button');
    errToggle.type = 'button';
    errToggle.className = 'liuli-diag-link';
    errToggle.textContent = '查看';
    errRow.appendChild(errCount);
    errRow.appendChild(errToggle);
    block.appendChild(errRow);
    const errList = document.createElement('div');
    errList.className = 'liuli-diag-errlist';
    block.appendChild(errList);
    let lastPath = '';
    let busy = false;
    const setStatus = function (text, level) {
      status.textContent = '状态：' + text;
      status.classList.toggle('is-ok', level === 'ok');
      status.classList.toggle('is-bad', level === 'bad');
    };
    const renderErrorList = function () {
      errList.innerHTML = '';
      const list = getErrors().slice(-10).reverse();
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'liuli-diag-err';
        empty.textContent = '本次启动没有捕获到错误。';
        errList.appendChild(empty);
        return;
      }
      list.forEach(function (e) {
        const item = document.createElement('div');
        item.className = 'liuli-diag-err';
        const head = document.createElement('div');
        head.className = 'liuli-diag-err__head';
        head.textContent = (e.t || '') + ' · ' + (e.level || 'error') + ' · ' + (e.scope || '');
        const msg = document.createElement('div');
        msg.className = 'liuli-diag-err__msg';
        msg.textContent = String(e.msg || '');
        item.appendChild(head);
        item.appendChild(msg);
        errList.appendChild(item);
      });
    };
    const refreshErrors = function () {
      errCount.textContent = '最近错误：' + getErrorCount() + ' 条';
      if (errList.classList.contains('is-open')) renderErrorList();
    };
    refreshErrors();
    refreshDiagnosticErrors = refreshErrors;
    errToggle.addEventListener('click', function () {
      const open = errList.classList.toggle('is-open');
      errToggle.textContent = open ? '收起' : '查看';
      if (open) renderErrorList();
    });
    exportBtn.addEventListener('click', async function () {
      if (busy) return;
      busy = true;
      exportBtn.disabled = true;
      openBtn.disabled = true;
      const oldLabel = exportBtn.textContent;
      exportBtn.textContent = '正在收集…';
      setStatus('正在收集…');
      const started = Date.now();
      const opts = {
        screenshots: !!shots.checked
      };
      try {
        const snap = await collectDiagnostics({
          files: true,
          quota: true,
          wallpaperDecode: true,
          defaultWallpaper: true
        });
        const payload = buildExportPayload(opts, snap);
        const api = window.LiuliHost;
        if (!api || typeof api.diagExport !== 'function') {
          throw new Error('主进程接口不可用：window.LiuliHost.diagExport 不存在');
        }
        const res = await api.diagExport(payload);
        if (!res || !res.ok) throw new Error((res && res.error) || '主进程返回失败');
        lastPath = res.path || '';
        setStatus(
          '已导出到 ' +
            (lastPath || '(未返回路径)') +
            (res.copiedTo ? '，已复制到 ' + res.copiedTo : '') +
            (res.size ? '（' + llFmtBytes(res.size) + '）' : ''),
          'ok'
        );
        openBtn.disabled = !lastPath;
        toast('诊断包已导出：' + (lastPath || ''));
        auditWallpaper('diag-export', {
          ok: true,
          path: lastPath,
          copiedTo: res.copiedTo || '',
          size: Number(res.size) || 0,
          ms: Date.now() - started,
          screenshots: opts.screenshots
        });
      } catch (e) {
        const msg = llErrText(e);
        setStatus('失败：' + msg, 'bad');
        toast('导出失败：' + msg);
        auditWallpaper('diag-export', {
          ok: false,
          error: msg,
          ms: Date.now() - started,
          screenshots: opts.screenshots
        });
      } finally {
        busy = false;
        exportBtn.disabled = false;
        exportBtn.textContent = oldLabel;
      }
    });
    openBtn.addEventListener('click', async function () {
      if (!lastPath) return;
      try {
        const api = window.LiuliHost;
        if (!api || typeof api.diagOpenPath !== 'function') {
          throw new Error('主进程接口不可用：window.LiuliHost.diagOpenPath 不存在');
        }
        const ok = await api.diagOpenPath(lastPath);
        if (!ok) throw new Error('系统没有打开该路径');
      } catch (e) {
        toast('打开文件夹失败：' + llErrText(e));
      }
    });
  }
  function buildVeilRow(veilKey, settings) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row liuli-veil-row';
    const label = document.createElement('span');
    label.textContent = '遮罩颜色';
    const seg = document.createElement('div');
    seg.className = 'liuli-seg';
    row.appendChild(label);
    row.appendChild(seg);
    const btns = {};
    [
      ['light', '亮'],
      ['dark', '暗']
    ].forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function () {
        settings[veilKey] = p[0];
        saveSettings(settings);
        applySettings(settings);
        refresh();
      });
      seg.appendChild(b);
      btns[p[0]] = b;
    });
    function refresh() {
      const v = settings[veilKey] === 'dark' ? 'dark' : 'light';
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('is-active', k === v);
      });
    }
    refresh();
    llVeilSegRefreshers.push(function (cfg) {
      const v = cfg && cfg[veilKey] === 'dark' ? 'dark' : 'light';
      settings[veilKey] = v;
      refresh();
    });
    return row;
  }
  const LL_TAB_KEY = 'liuli-settings-tab';
  const LL_TABS = [
    {
      key: 'look',
      label: '外观'
    },
    {
      key: 'wallpaper',
      label: '壁纸'
    },
    {
      key: 'color',
      label: '配色'
    },
    {
      key: 'layout',
      label: '布局'
    },
    {
      key: 'text',
      label: '文字'
    },
    {
      key: 'diag',
      label: '诊断'
    }
  ];
  function llSavedTab() {
    try {
      const v = localStorage.getItem(LL_TAB_KEY);
      return LL_TABS.some(function (t) {
        return t.key === v;
      })
        ? v
        : LL_TABS[0].key;
    } catch (e) {
      return LL_TABS[0].key;
    }
  }
  const LL_SECTION_INFO = {
    '主题': ['明暗模式与跟随系统', true],
    '材质': ['透明度、模糊、泛光与阴影', true],
    '壁纸设置': ['图片、视频与显示方式', true],
    '颜色角色': ['强调色、气泡与文字配色', true],
    '颜色来源': ['从壁纸取色或选择自定义颜色', true],
    '聊天消息': ['气泡样式、头像与图片昵称', true],
    '会话列表': ['置顶分组、选中底色与空会话', true],
    '输入框': ['TG 或原版输入布局', true],
    '输入框按钮': ['TG 布局专用 · 按钮数量与排序', false],
    '窗口按钮': ['标题栏与边缘提示 · 部分仅效率模式生效', false],
    '右键菜单': ['显示方式与菜单排序', false],
    '左侧边栏': ['快捷入口、导航与按钮显隐', false],
    '文字': ['字体与 Markdown 渲染', true],
    '消息文字层级': ['正文、昵称与头衔字号', true],
    '诊断': ['错误记录与诊断包导出', true]
  };
  // 只搬动现有节点；details 的开合不重建控件，也不写入主题设置。
  function llGroupSections(parent, state) {
    const headings = [...parent.children].filter(node => node.classList.contains('liuli-panel__group'));
    headings.forEach((heading, index) => {
      const title = heading.textContent.trim();
      const info = LL_SECTION_INFO[title] || ['展开查看此组设置', index === 0];
      const card = document.createElement('details');
      card.className = 'liuli-section';
      card.dataset.section = title;
      card.open = state.has(title) ? state.get(title) : info[1];
      const summary = document.createElement('summary');
      summary.className = 'liuli-section__summary';
      const description = document.createElement('span');
      description.className = 'liuli-section__description';
      description.textContent = info[0];
      const body = document.createElement('div');
      body.className = 'liuli-section__body';
      parent.insertBefore(card, heading);
      let node = heading.nextSibling;
      const boundary = headings[index + 1];
      while (node && node !== boundary) {
        const next = node.nextSibling;
        body.appendChild(node);
        node = next;
      }
      summary.append(heading, description);
      card.append(summary, body);
      card.addEventListener('toggle', () => state.set(title, card.open));
    });
  }
  function llOrganizePage(page, key) {
    const state = new Map();
    llGroupSections(page, state);
    for (const block of page.querySelectorAll(':scope > .liuli-wp-block')) {
      const title = block.querySelector(':scope > .liuli-wp-title');
      if (title) {
        title.classList.add('liuli-panel__group');
        llGroupSections(block, state);
        block.classList.add('liuli-section-shell');
      }
    }
    const layout = page.querySelector('.liuli-lo');
    if (layout) {
      const organizeLayout = () => {
        llGroupSections(layout, state);
        // 常用输入布局先出现；长排序列表留在各自的折叠卡片中。
        const input = layout.querySelector(':scope > [data-section="输入框"]');
        if (input && layout.firstElementChild !== input) layout.prepend(input);
      };
      organizeLayout();
      new MutationObserver(() => {
        if ([...layout.children].some(node => node.classList.contains('liuli-panel__group'))) organizeLayout();
      }).observe(layout, { childList: true });
      const chat = page.querySelector(':scope > [data-section="聊天消息"]');
      if (chat) page.prepend(chat);
      if (chat) chat.after(layout);
    }
    const intro = document.createElement('p');
    intro.className = 'liuli-page-guide';
    intro.textContent = key === 'layout'
      ? '先选气泡和输入框布局；按钮排序、窗口与导航设置可展开对应分组。'
      : '所有选项均在对应分组中，按需展开调整。';
    page.prepend(intro);
    llSyncSettingDependencies();
  }
  let llTabInstance = 0;
  function llBuildTabs(container, builders) {
    const list = LL_TABS;
    const bar = document.createElement('div');
    bar.className = 'liuli-seg liuli-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', '设置分区');
    container.appendChild(bar);
    const btns = {};
    const pages = {};
    const built = new Set();
    const tabId = 'liuli-tabs-' + ++llTabInstance;
    function show(key) {
      if (!pages[key]) key = list[0].key;
      if (!built.has(key)) {
        builders[key](pages[key]);
        llOrganizePage(pages[key], key);
        built.add(key);
      }
      Object.keys(pages).forEach(function (k) {
        const on = k === key;
        pages[k].classList.toggle('is-active', on);
        pages[k].hidden = !on;
      });
      Object.keys(btns).forEach(function (k) {
        const on = k === key;
        btns[k].classList.toggle('is-active', on);
        btns[k].setAttribute('aria-selected', on ? 'true' : 'false');
        btns[k].tabIndex = on ? 0 : -1;
      });
      try {
        localStorage.setItem(LL_TAB_KEY, key);
      } catch (e) {}
    }
    list.forEach(function (t) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = t.label;
      b.dataset.tab = t.key;
      b.id = tabId + '-' + t.key;
      b.setAttribute('aria-controls', b.id + '-page');
      b.setAttribute('role', 'tab');
      b.addEventListener('keydown', event => {
        const index = list.findIndex(tab => tab.key === t.key);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % list.length
            : event.key === 'ArrowLeft' ? (index + list.length - 1) % list.length : -1;
        if (next < 0) return;
        event.preventDefault();
        show(list[next].key);
        btns[list[next].key].focus();
      });
      b.addEventListener('click', function () {
        show(t.key);
      });
      bar.appendChild(b);
      btns[t.key] = b;
    });
    list.forEach(function (t) {
      const p = document.createElement('div');
      p.className = 'liuli-tabpage';
      p.dataset.tab = t.key;
      p.id = tabId + '-' + t.key + '-page';
      p.setAttribute('aria-labelledby', tabId + '-' + t.key);
      p.setAttribute('role', 'tabpanel');
      p.hidden = true;
      container.appendChild(p);
      pages[t.key] = p;
    });
    show(llSavedTab());
    return {
      bar: bar,
      pages: pages,
      show: show
    };
  }
  function buildLookControls(pageLook, settings) {
    Object.assign(settings, llModeCfg);
    const themeGroup = document.createElement('div');
    themeGroup.className = 'liuli-panel__group';
    themeGroup.textContent = '主题';
    pageLook.appendChild(themeGroup);
    buildModeControls(pageLook);
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '材质';
    pageLook.appendChild(group);
    const inputs = {};
    let frame = 0;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      applySettings(settings);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };
    for (const f of FIELDS) {
      const wrap = document.createElement('div');
      wrap.className = 'liuli-field';
      wrap.dataset.liuliMaterial = f.key;
      const row = document.createElement('div');
      row.className = 'liuli-field__row';
      const label = document.createElement('div');
      label.className = 'liuli-field__label';
      label.textContent = f.label;
      const value = document.createElement('div');
      value.className = 'liuli-field__value';
      row.appendChild(label);
      row.appendChild(value);
      wrap.appendChild(row);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'liuli-slider';
      slider.min = f.min;
      slider.max = f.max;
      slider.step = f.step;
      slider.value = settings[f.key];
      wrap.appendChild(slider);
      const hint = document.createElement('div');
      hint.className = 'liuli-field__hint';
      hint.textContent = f.hint;
      wrap.appendChild(hint);
      const sync = () => {
        const v = Number(slider.value);
        settings[f.key] = v;
        const pct = f.pct ? f.pct(v) : ((v - f.min) / (f.max - f.min)) * 100;
        slider.style.setProperty('--liuli-pct', Math.max(0, Math.min(100, pct)) + '%');
        value.textContent = f.key === 'opacity' ? v.toFixed(2) : f.unit ? v + f.unit : v.toFixed(2);
      };
      slider.addEventListener('input', () => {
        sync();
        schedule();
      });
      slider.addEventListener('change', () => {
        sync();
        flush();
        saveSettings(settings);
      });
      sync();
      inputs[f.key] = slider;
      if (f.veilKey) wrap.appendChild(buildVeilRow(f.veilKey, settings));
      pageLook.appendChild(wrap);
    }
    const veilNote = document.createElement('div');
    veilNote.className = 'liuli-field__hint liuli-veil__note';
    veilNote.textContent = '遮罩颜色：「亮」盖一层白，「暗」盖一层黑。';
    pageLook.appendChild(veilNote);
    const reset = document.createElement('div');
    reset.className = 'liuli-field__hint';
    reset.style.cssText = 'cursor:pointer;color:var(--ll-brand);margin-top:14px;';
    reset.textContent = '恢复默认';
    reset.addEventListener('click', () => {
      Object.assign(settings, DEFAULT_SETTINGS);
      for (const f of FIELDS) {
        inputs[f.key].value = settings[f.key];
        inputs[f.key].dispatchEvent(new Event('input'));
      }
      flush();
      llRefreshVeilSegs(settings);
      saveSettings(settings);
      toast('已恢复默认');
    });
    pageLook.appendChild(reset);
    const resetAll = document.createElement('div');
    resetAll.className = 'liuli-field__hint';
    resetAll.style.cssText = 'cursor:pointer;color:var(--ll-brand);margin-top:8px;';
    resetAll.textContent = '恢复全部默认';
    resetAll.addEventListener('click', async () => {
      if (!confirm('恢复全部默认设置？包括布局、明暗、壁纸、字体等，需要重启 QQ 生效。')) return;
      const ok = await llResetAll();
      Object.assign(settings, DEFAULT_SETTINGS);
      for (const f of FIELDS) {
        inputs[f.key].value = settings[f.key];
        inputs[f.key].dispatchEvent(new Event('input'));
      }
      flush();
      llRefreshVeilSegs(settings);
      toast(ok ? '已恢复全部默认，重启 QQ 生效' : '恢复失败，请在诊断页查看错误详情');
    });
    pageLook.appendChild(resetAll);
  }
  let llColorControlInstance = 0;
  function buildColorControls(pageColor, settings) {
    const sourceHeading = document.createElement('div');
    sourceHeading.className = 'liuli-panel__group';
    sourceHeading.textContent = '颜色来源';
    pageColor.appendChild(sourceHeading);
    const sourceRow = document.createElement('div');
    sourceRow.className = 'liuli-wp-fit liuli-mode-row';
    sourceRow.dataset.liuliSetting = 'colorSource';
    const sourceLabel = document.createElement('span');
    sourceLabel.textContent = '主题取色';
    const sourceButtons = document.createElement('div');
    sourceButtons.className = 'liuli-seg';
    sourceButtons.setAttribute('role', 'group');
    sourceButtons.setAttribute('aria-label', '主题颜色来源');
    for (const [value, label] of [['wallpaper', '壁纸取色'], ['custom', '自定义颜色']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'liuli-seg__item';
      button.textContent = label;
      button.dataset.settingValue = value;
      button.classList.toggle('is-active', settings.colorSource === value);
      button.addEventListener('click', () => {
        settings.colorSource = value;
        applySettings(settings, true);
      });
      sourceButtons.appendChild(button);
    }
    sourceRow.append(sourceLabel, sourceButtons);
    pageColor.appendChild(sourceRow);
    const card = document.createElement('div');
    card.className = 'liuli-palette-card';
    pageColor.appendChild(card);
    const custom = document.createElement('div');
    custom.className = 'liuli-color-custom';
    custom.dataset.liuliColorCustom = '1';
    const wheel = document.createElement('div');
    wheel.className = 'liuli-color-wheel';
    wheel.setAttribute('role', 'group');
    wheel.setAttribute('aria-label', '基础颜色色轮');
    const hueRing = document.createElement('div');
    hueRing.className = 'liuli-color-wheel__hue';
    hueRing.tabIndex = 0;
    hueRing.setAttribute('role', 'slider');
    hueRing.setAttribute('aria-label', '色相');
    hueRing.setAttribute('aria-valuemin', '0');
    hueRing.setAttribute('aria-valuemax', '359');
    const hueHandle = document.createElement('i');
    hueHandle.className = 'liuli-color-wheel__hue-handle';
    const sv = document.createElement('div');
    sv.className = 'liuli-color-wheel__sv';
    sv.tabIndex = 0;
    sv.setAttribute('role', 'slider');
    sv.setAttribute('aria-label', '饱和度与亮度');
    sv.setAttribute('aria-valuemin', '0');
    sv.setAttribute('aria-valuemax', '100');
    const svHandle = document.createElement('i');
    svHandle.className = 'liuli-color-wheel__sv-handle';
    sv.appendChild(svHandle);
    hueRing.appendChild(hueHandle);
    wheel.append(hueRing, sv);
    const customFields = document.createElement('div');
    customFields.className = 'liuli-color-fields';
    const customLabel = document.createElement('label');
    customLabel.className = 'liuli-color-fields__label';
    customLabel.textContent = '基础颜色';
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.id = 'liuli-color-hex-' + ++llColorControlInstance;
    customLabel.htmlFor = hex.id;
    hex.className = 'liuli-color-hex';
    hex.maxLength = 7;
    hex.pattern = '#[0-9a-fA-F]{6}';
    hex.placeholder = '#1d9bf0';
    hex.spellcheck = false;
    hex.autocomplete = 'off';
    hex.autocapitalize = 'off';
    hex.setAttribute('aria-label', '基础颜色十六进制值');
    const customHint = document.createElement('span');
    customHint.className = 'liuli-color-fields__hint';
    customHint.textContent = '色环选择色相，内圈调整明暗';
    const selectedColor = document.createElement('span');
    selectedColor.className = 'liuli-color-selected';
    selectedColor.setAttribute('aria-hidden', 'true');
    const keyboardHint = document.createElement('span');
    keyboardHint.className = 'liuli-color-fields__hint';
    keyboardHint.textContent = '也可聚焦色轮后用方向键微调';
    const error = document.createElement('span');
    error.id = 'liuli-color-error-' + llColorControlInstance;
    error.className = 'liuli-color-error';
    error.dataset.liuliColorError = '1';
    error.setAttribute('aria-live', 'polite');
    hex.setAttribute('aria-describedby', error.id);
    const commit = value => {
      const seed = llNormalizeColorSeed(value);
      const message = seed ? '' : '请输入 # 加六位十六进制颜色，例如 #1d9bf0。';
      hex.setCustomValidity(message);
      hex.setAttribute('aria-invalid', String(!seed));
      error.textContent = message;
      if (!seed) return;
      settings.customColor = seed;
      applySettings(settings, true);
    };
    let h = 0, s = 1, v = 1, lastSeed = '', colorFrame = 0;
    const clamp = number => Math.max(0, Math.min(1, number));
    const seedFromWheel = () => {
      const chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = v - chroma;
      const channels = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
      return '#' + channels.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
    };
    const drawWheel = () => {
      wheel.style.setProperty('--liuli-wheel-hue', h + 'deg');
      const angle = (h - 90) * Math.PI / 180;
      hueHandle.style.left = (50 + Math.cos(angle) * 45.4) + '%';
      hueHandle.style.top = (50 + Math.sin(angle) * 45.4) + '%';
      svHandle.style.left = s * 100 + '%';
      svHandle.style.top = (1 - v) * 100 + '%';
      svHandle.style.background = seedFromWheel();
      hueRing.setAttribute('aria-valuenow', String(Math.round(h)));
      hueRing.setAttribute('aria-valuetext', Math.round(h) + '度');
      sv.setAttribute('aria-valuenow', String(Math.round(s * 100)));
      sv.setAttribute('aria-valuetext', '饱和度 ' + Math.round(s * 100) + '%，亮度 ' + Math.round(v * 100) + '%');
    };
    custom.__liuliColorWheel = { setSeed(seed) {
      if (seed === lastSeed || !llNormalizeColorSeed(seed)) return;
      lastSeed = seed;
      const channels = [1, 3, 5].map(start => parseInt(seed.slice(start, start + 2), 16) / 255);
      const max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
      if (delta) {
        const [r, g, b] = channels;
        h = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
      }
      s = max ? delta / max : 0;
      v = max;
      drawWheel();
    } };
    const commitWheel = () => {
      colorFrame = 0;
      if (!custom.isConnected) return;
      lastSeed = seedFromWheel();
      commit(lastSeed);
    };
    const queueWheel = () => {
      drawWheel();
      if (!colorFrame) colorFrame = requestAnimationFrame(commitWheel);
    };
    const bindDrag = (control, update) => {
      let pointer = null;
      control.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        control.focus();
        pointer = event.pointerId;
        control.setPointerCapture(pointer);
        update(event); queueWheel();
      });
      control.addEventListener('pointermove', event => {
        if (event.pointerId !== pointer) return;
        update(event); queueWheel();
      });
      const finish = event => {
        if (event.pointerId !== pointer) return;
        pointer = null;
        if (colorFrame) { cancelAnimationFrame(colorFrame); commitWheel(); }
        if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
      };
      control.addEventListener('pointerup', finish);
      control.addEventListener('pointercancel', finish);
      control.addEventListener('lostpointercapture', () => { pointer = null; });
    };
    bindDrag(hueRing, event => {
      const rect = hueRing.getBoundingClientRect();
      h = (Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2) * 180 / Math.PI + 450) % 360;
    });
    bindDrag(sv, event => {
      const rect = sv.getBoundingClientRect();
      s = clamp((event.clientX - rect.left) / rect.width);
      v = clamp(1 - (event.clientY - rect.top) / rect.height);
    });
    hueRing.addEventListener('keydown', event => {
      const step = event.shiftKey ? 10 : 1;
      const offset = ['ArrowRight', 'ArrowUp'].includes(event.key) ? step : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -step : 0;
      if (!offset && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      h = event.key === 'Home' ? 0 : event.key === 'End' ? 359 : (h + offset + 360) % 360;
      queueWheel();
    });
    sv.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.1 : 0.01;
      if (event.key === 'ArrowLeft') s = clamp(s - step);
      if (event.key === 'ArrowRight') s = clamp(s + step);
      if (event.key === 'ArrowUp') v = clamp(v + step);
      if (event.key === 'ArrowDown') v = clamp(v - step);
      queueWheel();
    });
    hex.addEventListener('input', () => commit(hex.value));
    customFields.append(selectedColor, customLabel, hex, customHint, keyboardHint);
    custom.append(wheel, customFields, error);
    card.appendChild(custom);
    const info = document.createElement('div');
    info.className = 'liuli-palette-heading';
    const previewTitle = document.createElement('span');
    previewTitle.className = 'liuli-palette-heading__title';
    previewTitle.textContent = '派生配色';
    const infoText = document.createElement('span');
    infoText.className = 'liuli-palette-heading__source';
    info.append(previewTitle, infoText);
    card.appendChild(info);
    const previews = document.createElement('div');
    previews.className = 'liuli-palette-preview';
    previews.setAttribute('aria-label', '当前主题颜色角色预览');
    for (const [label, background, foreground] of [
      ['强调色', '--ll-brand', '--ll-on-brand'],
      ['选中底色', '--ll-primary-container', '--ll-on-primary-container'],
      ['次色底色', '--ll-secondary-container', '--ll-on-secondary-container'],
      ['第三色底色', '--ll-tertiary-container', '--ll-on-tertiary-container'],
      ['页面背景', '--ll-app-bg', '--ll-on-glass'],
      ['中性表面', '--ll-surface-2', '--ll-on-glass'],
      ['自己的气泡', '--ll-bubble-self', '--ll-bubble-self-fg'],
      ['对方的气泡', '--ll-bubble-other', '--ll-bubble-other-fg']
    ]) {
      const item = document.createElement('div');
      item.className = 'liuli-palette-role';
      const sample = document.createElement('div');
      sample.className = 'liuli-palette-role__sample';
      sample.style.background = 'var(' + background + ', rgba(var(--ll-acrylic), 0.86))';
      sample.style.color = 'var(' + foreground + ', var(--ll-on-glass))';
      sample.setAttribute('aria-hidden', 'true');
      const letters = document.createElement('span');
      letters.textContent = 'Aa';
      const dot = document.createElement('i');
      sample.append(letters, dot);
      const name = document.createElement('div');
      name.className = 'liuli-palette-role__name';
      name.textContent = label;
      const values = document.createElement('div');
      values.className = 'liuli-palette-role__values';
      const backgroundValue = document.createElement('code');
      const foregroundValue = document.createElement('code');
      values.append(backgroundValue, foregroundValue);
      item.append(sample, name, values);
      previews.appendChild(item);
    }
    card.appendChild(previews);
    const colorText = value => {
      const parts = value.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return value;
      const hexValue = '#' + parts.slice(0, 3).map(part => Math.round(Number(part)).toString(16).padStart(2, '0')).join('');
      const alpha = parts.length > 3 ? Number(parts[3]) : 1;
      return hexValue.toUpperCase() + (alpha < 1 ? ' · ' + Math.round(alpha * 100) + '%' : '');
    };
    const refreshInfo = () => {
      const src = document.body.dataset.liuliSource || DEFAULT_SOURCE;
      const label = llModeCfg.colorSource === 'custom' ? '基础色' : '壁纸取色';
      // The settings dialog and embedded settings page may coexist. Refresh the
      // connected cards together, including their text values, on palette apply.
      for (const paletteCard of new Set([card, ...document.querySelectorAll('.liuli-palette-card')])) {
        paletteCard.querySelector('.liuli-palette-heading__source').textContent = label + ' ' + src.toUpperCase();
        for (const item of paletteCard.querySelectorAll('.liuli-palette-role')) {
          const appearance = getComputedStyle(item.querySelector('.liuli-palette-role__sample'));
          const background = colorText(appearance.backgroundColor);
          const foreground = colorText(appearance.color);
          const [backgroundValue, foregroundValue] = item.querySelectorAll('code');
          backgroundValue.textContent = background;
          foregroundValue.textContent = foreground;
          backgroundValue.title = '背景 ' + background;
          foregroundValue.title = '文字 ' + foreground;
          item.setAttribute('aria-label', item.querySelector('.liuli-palette-role__name').textContent + '，背景 ' + background + '，文字 ' + foreground);
        }
      }
    };
    refreshInfo();
    refreshPaletteInfo = refreshInfo;
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '颜色角色';
    pageColor.appendChild(group);
    buildRoleControls(pageColor, function () {
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
    });
    llSyncColorSourceControls();
  }
  function buildPanelContent(host, settings) {
    host.innerHTML = '';
    llPanelSettings.add(settings);
    llVeilSegRefreshers = [];
    const sub = document.createElement('div');
    sub.className = 'liuli-panel__sub';
    sub.textContent = '外观、聊天与布局 · 调整即时生效';
    host.appendChild(sub);
    llBuildTabs(host, {
      look: page => buildLookControls(page, settings),
      wallpaper: buildWallpaperControls,
      color: page => buildColorControls(page, settings),
      layout: page => {
        // 布局页由 layout-custom.js 构建；会话列表这一组属于主题自己的设置，
        // 追加在它后面（layout-custom.js 不碰主题设置存储）。
        buildLayoutSection(page);
        buildPinGroupSection(page, settings);
      },
      text: page => {
        const group = document.createElement('div');
        group.className = 'liuli-panel__group';
        group.textContent = '文字';
        page.appendChild(group);
        buildMarkdownControls(page);
        buildFontControls(page);
        buildMessageTypeControls(page, settings);
      },
      diag: buildDiagSection
    });
  }
  async function initPanel() {
    const settings = await loadSettings();
    applySettings(settings, true);
  }
  const themeReady = (async () => {
    const started = Date.now();
    installRouteScope();
    try {
      const chunks = await Promise.all(
        FILES.map(async file => {
          try {
            return await loadText(file);
          } catch (e) {
            if (!OPTIONAL_FILES.has(file)) throw e;
            return '';
          }
        })
      );
      ensureStyle().textContent = chunks.join('\n');
      document.body.dataset.liuliTheme = 'dsh';
      llApplyFont();
      try {
        const m0 = llThemeMode();
        if (m0 !== 'auto') document.body.dataset.liuliMode = m0;
        document.body.dataset.liuliDark = llIsDark() ? '1' : '0';
      } catch (e) {}
      const paletteReady = applyDynamicPalette().catch(e => {
        console.warn('[theme] dynamic palette failed:', e && e.message);
      });
      const bootWallpaper = loadWallpaperState();
      const wallpaperReady = bootWallpaper.src ? primeImageRatio(bootWallpaper.src) : null;
      renderWallpaper(bootWallpaper, 'boot');
      try {
        installLayout(function () {
          llSyncPins();
          refreshInputGeometry();
        });
      } catch (e) {
        console.warn('[theme] layout failed:', e && e.message);
      }
      try {
        installArkExternal(window.LiuliHost);
      } catch (e) {
        console.warn('[theme] ark external failed:', e && e.message);
      }
      installAvatarStick();
      installRowEntryMotion();
      installPageObserver();
      try {
        installSwitchMotion();
      } catch (e) {
        console.warn('[theme] switch motion failed:', e && e.message);
      }
      try {
        await initPanel();
      } catch (e) {
        console.warn('[theme] panel failed:', e && e.message);
      }
      await Promise.all([paletteReady, wallpaperReady]);
      renderWallpaper(loadWallpaperState(), 'boot-ready');
      console.log('[theme] ready in ' + (Date.now() - started) + 'ms');
      markBootReady();
    } catch (error) {
      const reason = (error && error.message) || String(error || '未知异常');
      console.error('[theme] inject failed:', reason);
      try {
        document.body.dataset.liuliTheme = 'failed';
      } catch (e) {}
      try {
        noteThemeFailure(reason);
      } catch (e) {}
      markBootFailed(error);
      throw error;
    }
  })();
  const onSettingWindowCreated = async view => {
    let cfg;
    try {
      cfg = await loadSettings();
    } catch (e) {
      cfg = Object.assign({}, DEFAULT_SETTINGS);
    }
    window.__liuliSettingsCache = cfg;
    const box = document.createElement('div');
    box.id = 'liuli-embedded';
    box.className = 'liuli-embedded';
    try {
      view.appendChild(box);
      buildPanelContent(box, cfg);
      try {
        notePanelBuild(true);
      } catch (e) {}
    } catch (error) {
      const reason = (error && error.message) || String(error || '未知异常');
      try {
        notePanelBuild(false, reason);
      } catch (e) {}
      try {
        console.error('[theme] settings panel build failed:', reason);
      } catch (e) {}
      throw error;
    }
  };
  window.__liuliRenderSettings = onSettingWindowCreated;
  const LL_MD_KEY = 'liuli-md-render';
  const LL_MD_TRIGGER = /`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\|/;
  function llMdEnabled() {
    try {
      return localStorage.getItem(LL_MD_KEY) !== '0';
    } catch (e) {
      return true;
    }
  }
  function llInlineMarkdown(md) {
    return md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\s][^*\n]*)\*/g, '<em>$1</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\|\|([^|\n]+)\|\|/g, '<span class="ll-spoiler">$1</span>')
      .replace(/\n/g, '<br>');
  }
  function llMarkdownPass(root = document.body) {
    try {
      const on = llMdEnabled();
      const els = elementsWithin(root, '.ml-item .text-normal');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!on) {
          if (el.__llMdSrc !== undefined) {
            el.textContent = el.__llMdSrc;
            el.__llMdSrc = undefined;
            el.__llMdSeen = undefined;
            const box = el.closest('.message-content');
            if (box) box.classList.remove('ll-inline-md');
          }
          continue;
        }
        const text = el.textContent;
        if (el.__llMdSeen === text) continue;
        if (!LL_MD_TRIGGER.test(text)) {
          el.__llMdSeen = text;
          el.__llMdSrc = undefined;
          continue;
        }
        el.__llMdSrc = text;
        el.innerHTML = llInlineMarkdown(text);
        el.__llMdSeen = el.textContent;
        const box = el.closest('.message-content');
        if (box) box.classList.add('ll-inline-md');
      }
    } catch (e) {}
  }
  /* 通用「开启 / 关闭」开关行。
   * 为什么抽出来：布局页新增的「会话列表」开关必须和文字页的 Markdown 渲染
   * 完全同款——同一组类名（.liuli-wp-fit + .liuli-mode-row + .liuli-seg）、
   * 同样的 开启 / 关闭 顺序、同样的 is-active 高亮，以后改一处两边都变。 */
  function llBuildSwitchRow(host, label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row';
    const text = document.createElement('span');
    text.textContent = label;
    const seg = document.createElement('div');
    seg.className = 'liuli-seg';
    row.appendChild(text);
    row.appendChild(seg);
    host.appendChild(row);
    const btns = {};
    [
      ['1', '开启'],
      ['0', '关闭']
    ].forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function () {
        refresh(p[0]);
        onChange(p[0] === '1');
      });
      seg.appendChild(b);
      btns[p[0]] = b;
    });
    function refresh(cur) {
      const active = cur != null ? cur : value ? '1' : '0';
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('is-active', k === active);
      });
    }
    refresh();
    return row;
  }
  function buildMarkdownControls(host) {
    const row = llBuildSwitchRow(host, 'Markdown 渲染', llMdEnabled(), function (on) {
      try {
        localStorage.setItem(LL_MD_KEY, on ? '1' : '0');
      } catch (err) {}
      llMarkdownPass();
    });
  }
  /* 「布局 → 会话列表」：两个开关直接改面板持有的 settings 对象再整体保存。
   * 为什么不单独读一份：外观页签的滑杆保存时会整体写 settings，如果这几项
   * 只写在 localStorage、不写回同一个对象，切到外观页动一下滑杆就会被旧值覆盖。 */
  function buildPinGroupSection(host, settings) {
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '会话列表';
    host.appendChild(group);
    function persist(key, value) {
      settings[key] = value;
      applySettings(settings, true);
    }
    function settingSwitch(label, key, value, onChange) {
      const row = llBuildSwitchRow(host, label, value, onChange || (on => persist(key, on)));
      row.dataset.liuliSetting = key;
      [...row.querySelectorAll('button')].forEach((button, i) => {
        button.dataset.settingValue = String(i === 0);
      });
    }
    settingSwitch('置顶会话单独成组', 'pinGroup', settings.pinGroup !== false, function (on) {
      if (!on) settings.pinCollapsed = false;
      persist('pinGroup', on);
    });
    const hint = document.createElement('div');
    hint.className = 'liuli-field__hint';
    hint.textContent = '列表顶部显示「置顶 · N」小标题，点小标题可以折叠';
    host.appendChild(hint);
    const strengthField = document.createElement('div');
    strengthField.className = 'liuli-field';
    const strengthRow = document.createElement('div');
    strengthRow.className = 'liuli-field__row';
    const strengthLabel = document.createElement('div');
    strengthLabel.className = 'liuli-field__label';
    strengthLabel.textContent = '选中会话底色浓度';
    const strengthValue = document.createElement('div');
    strengthValue.className = 'liuli-field__value';
    strengthValue.textContent = settings.selectedStrength + '%';
    const strengthInput = document.createElement('input');
    strengthInput.type = 'range';
    strengthInput.className = 'liuli-slider';
    strengthInput.dataset.liuliSetting = 'selectedStrength';
    strengthInput.dataset.unit = '%';
    strengthInput.min = 15;
    strengthInput.max = 100;
    strengthInput.step = 5;
    strengthInput.value = settings.selectedStrength;
    strengthInput.style.setProperty('--liuli-pct', (settings.selectedStrength - 15) / 85 * 100 + '%');
    strengthInput.addEventListener('input', () => persist('selectedStrength', Number(strengthInput.value)));
    strengthRow.append(strengthLabel, strengthValue);
    strengthField.append(strengthRow, strengthInput);
    host.appendChild(strengthField);
    settingSwitch('置顶分组使用强调色', 'pinColor', settings.pinColor === true);
    const colorHint = document.createElement('div');
    colorHint.className = 'liuli-field__hint';
    colorHint.textContent = '开启「置顶会话单独成组」后生效；关闭分组仍保留颜色选项。使用主题强调色的容器底色和文字色。';
    host.appendChild(colorHint);
    settingSwitch('隐藏空会话的 QQ 图标', 'hideEmptyLogo', settings.hideEmptyLogo !== false);
    const messageGroup = document.createElement('div');
    messageGroup.className = 'liuli-panel__group';
    messageGroup.textContent = '聊天消息';
    host.appendChild(messageGroup);
    function choice(label, key, options) {
      const row = document.createElement('div');
      row.className = 'liuli-wp-fit liuli-mode-row';
      row.dataset.liuliSetting = key;
      const caption = document.createElement('span');
      caption.textContent = label;
      const seg = document.createElement('div');
      seg.className = 'liuli-seg';
      for (const [value, text] of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'liuli-seg__item';
        button.textContent = text;
        button.dataset.settingValue = value;
        button.classList.toggle('is-active', settings[key] === value);
        button.addEventListener('click', () => {
          settings[key] = value;
          applySettings(settings, true);
          for (const child of seg.children) child.classList.toggle('is-active', child === button);
        });
        seg.appendChild(button);
      }
      row.append(caption, seg);
      host.appendChild(row);
    }
    choice('聊天气泡', 'chatStyle', [['tg', 'TG'], ['classic', '原版'], ['tim', 'TIM']]);
    const bubbleHint = document.createElement('div');
    bubbleHint.className = 'liuli-field__hint';
    bubbleHint.textContent = '原版和 TIM 保留各自气泡形状，颜色角色与材质跟随主题。TG 和 TIM 可合并连续消息的头像。';
    host.appendChild(bubbleHint);
    choice('头像位置（TG / TIM）', 'avatarPosition', [['top', '消息开头'], ['bottom', '消息末尾']]);
    choice('名称与标签位置（TIM）', 'timSenderPosition', [['inside', '气泡内（TG）'], ['outside', '气泡外（原版）']]);
    const scaleField = document.createElement('div');
    scaleField.className = 'liuli-field';
    const scaleRow = document.createElement('div');
    scaleRow.className = 'liuli-field__row';
    const scaleLabel = document.createElement('div');
    scaleLabel.className = 'liuli-field__label';
    scaleLabel.textContent = '气泡大小';
    const scaleValue = document.createElement('div');
    scaleValue.className = 'liuli-field__value';
    scaleValue.textContent = settings.bubbleScale + '%';
    const scaleInput = document.createElement('input');
    scaleInput.type = 'range';
    scaleInput.className = 'liuli-slider';
    scaleInput.dataset.liuliSetting = 'bubbleScale';
    scaleInput.dataset.unit = '%';
    scaleInput.min = 80;
    scaleInput.max = 140;
    scaleInput.step = 5;
    scaleInput.value = settings.bubbleScale;
    scaleInput.style.setProperty('--liuli-pct', (settings.bubbleScale - 80) / 60 * 100 + '%');
    scaleInput.addEventListener('input', () => persist('bubbleScale', Number(scaleInput.value)));
    scaleRow.append(scaleLabel, scaleValue);
    scaleField.append(scaleRow, scaleInput);
    host.appendChild(scaleField);
    const scaleHint = document.createElement('div');
    scaleHint.className = 'liuli-field__hint';
    scaleHint.textContent = '调整气泡留白和语音自然尺寸；文字字号、图片大小与最大宽度分别设置。';
    host.appendChild(scaleHint);
    const widthField = document.createElement('div');
    widthField.className = 'liuli-field';
    const widthRow = document.createElement('div');
    widthRow.className = 'liuli-field__row';
    const widthLabel = document.createElement('div');
    widthLabel.className = 'liuli-field__label';
    widthLabel.textContent = '气泡最大宽度';
    const widthValue = document.createElement('div');
    widthValue.className = 'liuli-field__value';
    widthValue.textContent = settings.bubbleMaxWidth + '%';
    const widthInput = document.createElement('input');
    widthInput.type = 'range';
    widthInput.className = 'liuli-slider';
    widthInput.dataset.liuliSetting = 'bubbleMaxWidth';
    widthInput.dataset.unit = '%';
    widthInput.min = 40;
    widthInput.max = 100;
    widthInput.step = 5;
    widthInput.value = settings.bubbleMaxWidth;
    widthInput.style.setProperty('--liuli-pct', (settings.bubbleMaxWidth - 40) / 60 * 100 + '%');
    widthInput.addEventListener('input', () => persist('bubbleMaxWidth', Number(widthInput.value)));
    widthRow.append(widthLabel, widthValue);
    widthField.append(widthRow, widthInput);
    host.appendChild(widthField);
    const widthHint = document.createElement('div');
    widthHint.className = 'liuli-field__hint';
    widthHint.textContent = '只限制消息最大宽度，不缩放气泡、文字或语音。短消息保持自然大小；100% 使用 QQ 原生宽度上限。';
    host.appendChild(widthHint);
    settingSwitch('隐藏纯图片消息的昵称', 'hideImageNames', settings.hideImageNames === true);
    const imageHint = document.createElement('div');
    imageHint.className = 'liuli-field__hint';
    imageHint.textContent = '同时隐藏图片上方的头衔；带文字或引用的混合消息保留昵称。';
    host.appendChild(imageHint);
    for (const [label, key, description] of [
      ['显示群头衔', 'showMessageTitles', '只控制昵称旁的个性群头衔，保留昵称和群主、管理员身份。'],
      ['显示群主 / 管理员身份', 'showMessageIdentity', '只控制群主、管理员身份标签，保留昵称和个性群头衔。'],
      ['名称按气泡宽度省略', 'truncateMessageNames', '开启后长昵称按气泡宽度省略；关闭后可显示完整名称，短消息的名称行可能更宽。']
    ]) {
      settingSwitch(label, key, settings[key] !== false);
      const detail = document.createElement('div');
      detail.className = 'liuli-field__hint';
      detail.textContent = description;
      host.appendChild(detail);
    }
  }
  function buildMessageTypeControls(host, settings) {
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '消息文字层级';
    host.appendChild(group);
    const rows = [];
    function sync() {
      Object.assign(settings, llNormalizeSettings(settings));
      for (const row of rows) {
        row.input.value = settings[row.key];
        row.value.textContent = settings[row.key] + 'px';
        const ratio = (settings[row.key] - Number(row.input.min)) /
          (Number(row.input.max) - Number(row.input.min));
        row.input.style.setProperty('--liuli-pct', ratio * 100 + '%');
      }
      applySettings(settings, true);
    }
    for (const [key, text, min, max] of [
      ['messageFontSize', '消息正文', 12, 24],
      ['nameFontSize', '发送者昵称', 10, 18],
      ['titleFontSize', '群头衔与身份标签', 9, 14]
    ]) {
      const field = document.createElement('div');
      field.className = 'liuli-field';
      const top = document.createElement('div');
      top.className = 'liuli-field__row';
      const label = document.createElement('div');
      label.className = 'liuli-field__label';
      label.textContent = text;
      const value = document.createElement('div');
      value.className = 'liuli-field__value';
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'liuli-slider liuli-type-slider';
      input.dataset.liuliSetting = key;
      input.min = min;
      input.max = max;
      input.step = 1;
      input.addEventListener('input', () => { settings[key] = Number(input.value); sync(); });
      top.append(label, value);
      field.append(top, input);
      host.appendChild(field);
      rows.push({ key, input, value });
    }
    const hint = document.createElement('div');
    hint.className = 'liuli-field__hint';
    hint.textContent = '昵称字号不超过消息正文，头衔字号不超过昵称；长昵称在气泡范围内省略。';
    host.appendChild(hint);
    // 初始化只画控件，不保存或广播，避免打开设置页改变当前配置。
    for (const row of rows) {
      row.input.value = settings[row.key];
      row.value.textContent = settings[row.key] + 'px';
      row.input.style.setProperty('--liuli-pct', (settings[row.key] - Number(row.input.min)) /
        (Number(row.input.max) - Number(row.input.min)) * 100 + '%');
    }
  }

  function llMsgRecordOf(el) {
    return window.LiuliQQ.messageRecord(el);
  }
  let llSelfUid = '';
  let llSelfUidRequest = null;
  function llLoadSelfUid() {
    if (llSelfUid || llSelfUidRequest || !window.LiuliHost) return;
    llSelfUidRequest = window.LiuliHost.selfUid()
      .then(uid => {
        if (uid) {
          llSelfUid = String(uid);
          llAtPass();
        }
      })
      .catch(() => {})
      .finally(() => {
        llSelfUidRequest = null;
      });
  }
  function llAtPass(root = document.body) {
    try {
      if (!llSelfUid) {
        llLoadSelfUid();
        return;
      }
      const ats = elementsWithin(root, '.ml-item .text-element--at');
      for (let i = 0; i < ats.length; i++) {
        const at = ats[i];
        const holder = at.closest('[data-element-id]');
        if (!holder) continue;
        const id = holder.getAttribute('data-element-id');
        if (at.dataset.llAtId === id) continue;
        const rec = llMsgRecordOf(at);
        if (!rec || !Array.isArray(rec.elements)) continue;
        const el = rec.elements.find(e => String(e.elementId) === id);
        const te = el && el.textElement;
        if (!te) continue;
        const me = te.atType === 1 || (te.atNtUid && String(te.atNtUid) === llSelfUid);
        at.dataset.llAt = me ? 'me' : 'other';
        at.dataset.llAtId = id;
      }
    } catch (e) {}
  }
  const LL_FONT_KEY = 'liuli-font';
  const LL_FONT_CANDIDATES = [
    'MiSans',
    'HarmonyOS Sans SC',
    'OPPOSans',
    'vivo Sans',
    'Alibaba PuHuiTi 3.0',
    '阿里巴巴普惠体 3.0',
    'LXGW WenKai',
    '霞鹜文楷',
    'LXGW WenKai Screen',
    '霞鹜文楷 屏幕阅读版',
    'Source Han Sans SC',
    '思源黑体',
    'Noto Sans SC',
    'Noto Sans CJK SC',
    'Sarasa UI SC',
    '更纱黑体 UI SC',
    'Microsoft YaHei UI',
    'Microsoft YaHei',
    '微软雅黑',
    'DengXian',
    '等线',
    'PingFang SC',
    'Inter',
    'Segoe UI',
    'SimHei',
    '黑体',
    'KaiTi',
    '楷体',
    'SimSun',
    '宋体',
    'FangSong',
    '仿宋'
  ];
  function llFontName() {
    try {
      return (localStorage.getItem(LL_FONT_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  }
  function llCleanFont(name) {
    return String(name || '')
      .replace(/["'\\;{}<>]/g, '')
      .trim()
      .slice(0, 64);
  }
  function llApplyFont() {
    const name = llCleanFont(llFontName());
    const b = document.body;
    if (!b) return;
    if (!name) {
      b.style.removeProperty('--ll-font');
      delete b.dataset.llFont;
      return;
    }
    b.style.setProperty(
      '--ll-font',
      '"' + name + '", "MiSans", "Microsoft YaHei UI", system-ui, sans-serif, "Segoe UI Emoji"'
    );
    b.dataset.llFont = '1';
  }
  window.addEventListener('storage', e => {
    if (e.key === LL_FONT_KEY) llApplyFont();
  });
  let llFontCtx = null;
  function llFontInstalled(name) {
    try {
      if (!llFontCtx) llFontCtx = document.createElement('canvas').getContext('2d');
      const sample = '永和九年岁在癸丑 Hamburgefonstiv 0123';
      for (const base of ['monospace', 'serif']) {
        llFontCtx.font = '32px ' + base;
        const w0 = llFontCtx.measureText(sample).width;
        llFontCtx.font = '32px "' + name + '", ' + base;
        if (llFontCtx.measureText(sample).width !== w0) return true;
      }
    } catch (e) {}
    return false;
  }
  async function llListFonts() {
    try {
      if (window.queryLocalFonts) {
        const fonts = await window.queryLocalFonts();
        const names = Array.from(new Set(fonts.map(f => f.family))).sort((a, b) =>
          a.localeCompare(b, 'zh')
        );
        if (names.length) return names;
      }
    } catch (e) {}
    return LL_FONT_CANDIDATES.filter(llFontInstalled);
  }
  function buildFontControls(host) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row';
    const label = document.createElement('span');
    label.textContent = '字体';
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;gap:6px;align-items:center;flex:1;min-width:0;justify-content:flex-end;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '默认（MiSans）';
    input.value = llFontName();
    input.setAttribute('list', 'liuli-font-list');
    input.style.cssText =
      'width:180px;max-width:100%;min-width:0;flex:1;height:28px;padding:0 10px;border-radius:8px;border:none;outline:none;' +
      'background:rgba(var(--ll-on-glass-rgb),0.08);color:var(--ll-on-glass);font:inherit;font-size:13px;';
    const list = document.createElement('datalist');
    list.id = 'liuli-font-list';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'liuli-seg__item';
    reset.textContent = '默认';
    box.appendChild(input);
    box.appendChild(list);
    box.appendChild(reset);
    row.appendChild(label);
    row.appendChild(box);
    host.appendChild(row);
    const apply = name => {
      name = llCleanFont(name);
      try {
        if (name) localStorage.setItem(LL_FONT_KEY, name);
        else localStorage.removeItem(LL_FONT_KEY);
      } catch (e) {}
      input.value = name;
      llApplyFont();
    };
    input.addEventListener('change', () => apply(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') apply(input.value);
    });
    reset.addEventListener('click', () => apply(''));
    llListFonts().then(names => {
      list.innerHTML = '';
      for (const n of names) {
        const o = document.createElement('option');
        o.value = n;
        list.appendChild(o);
      }
      input.title = names.length
        ? '本机可用 ' + names.length + ' 种，点输入框可选'
        : '直接输入字体名';
    });
  }
  function mountSettingsEntry() {
    const controls =
      document.querySelector('.window-control-area:has(.mini-fishing-entry)') ||
      document.querySelector(
        '.window-title-bar .window-control-area:not(.window-title-bar__controls-left)'
      );
    if (!controls) return;
    const mini = controls.querySelector('.mini-fishing-entry');
    // Settings now live in QQ's settings window. Restore the native mini entry
    // if an older theme version left its replacement-era inline override.
    if (mini && mini.style.getPropertyValue('display') === 'none' &&
        mini.style.getPropertyPriority('display') === 'important') {
      mini.style.removeProperty('display');
    }
    // 设置页已经挂到 QQ 设置窗口，标题栏不再放主题齿轮。
  }
  const themeEntry = document.createElement('button');
  themeEntry.id = 'liuli-settings-entry';
  themeEntry.type = 'button';
  themeEntry.title = '主题设置';
  themeEntry.setAttribute('aria-label', '打开主题设置');
  themeEntry.setAttribute('aria-haspopup', 'dialog');
  themeEntry.setAttribute('aria-expanded', 'false');
  themeEntry.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const themeDialog = document.createElement('dialog');
  themeDialog.id = 'liuli-settings-dialog';
  themeDialog.setAttribute('aria-labelledby', 'liuli-settings-heading');
  const dialogHeader = document.createElement('header');
  dialogHeader.className = 'liuli-dialog-header';
  const heading = document.createElement('h1');
  heading.id = 'liuli-settings-heading';
  heading.textContent = '主题设置';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', '关闭主题设置');
  dialogHeader.append(heading, closeButton);
  themeDialog.append(dialogHeader);
  document.body.append(themeDialog);
  let panelReady;
  async function openSettings() {
    panelReady ??= onSettingWindowCreated(themeDialog).catch(error => {
      panelReady = undefined;
      throw error;
    });
    await panelReady;
    if (!themeDialog.open) themeDialog.showModal();
    themeEntry.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
  }
  function closeSettings() {
    themeDialog.close();
    themeEntry.setAttribute('aria-expanded', 'false');
    themeEntry.focus({ preventScroll: true });
  }
  themeEntry.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openSettings().catch(error => console.error('[theme] settings failed', error));
  });
  closeButton.addEventListener('click', closeSettings);
  themeDialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeSettings();
  });
  themeDialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    }
  });
  themeDialog.addEventListener('click', event => {
    const rect = themeDialog.getBoundingClientRect();
    if (
      event.target === themeDialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      closeSettings();
  });
  mountSettingsEntry();
  window.SnowLoraLiuli = { open: openSettings, mount: mountSettingsEntry, ready: themeReady };

  /* SnowLora：设置窗（#/setting）里挂一个「琉璃」导航页，复用 buildPanelContent。
   * SnowLora 主进程在 window_created 时按规则注入本文件；这里等 QQ 设置页 DOM 就绪后挂载。 */
  function mountLiuliSettingsPage() {
    let tries = 0;
    const tick = () => {
      const tab = document.querySelector('.setting-tab');
      const navBar = tab && tab.querySelector('.nav-bar');
      const main = document.querySelector('.setting-main .setting-main__content');
      const original = document.querySelector('.setting-main .q-scroll-view');
      const title = document.querySelector('.setting-main .setting-title');
      const sample = navBar && navBar.querySelector('.nav-item');
      if (!tab || !navBar || !main || !original || !title || !sample) {
        if (tries++ < 80) setTimeout(tick, 250);
        return;
      }
      if (tab.querySelector('.liuli-settings-nav')) return;
      const nav = sample.cloneNode(true);
      nav.classList.remove('nav-item-active');
      nav.classList.add('liuli-settings-nav');
      const name = nav.querySelector('.name');
      if (name) name.textContent = '琉璃';
      else nav.textContent = '琉璃';
      const group = document.createElement('div');
      group.className = 'nav-bar liuli-settings-navbar';
      group.append(nav);
      tab.append(group);
      const view = document.createElement('div');
      view.className = 'q-scroll-view scroll-view--show-scrollbar';
      view.style.display = 'none';
      main.append(view);
      let navigationSequence = 0;
      let renderPending = null;
      let titleNode = null;
      let titleSaved = null;
      nav.addEventListener('click', async () => {
        const ticket = navigationSequence;
        // 共用初始化 Promise；切走后旧请求只能准备内容，不能夺回页面。
        if (!renderPending) renderPending = (async () => {
          try {
            await window.__liuliRenderSettings(view);
            view.dataset.ready = '1';
          } catch (e) {
            view.textContent = '主题设置加载失败：' + (e && e.message ? e.message : e);
          }
        })();
        await renderPending;
        if (ticket !== navigationSequence || !nav.isConnected) return;
        original.style.display = 'none';
        view.style.display = 'block';
        // 标题结构是 <div.setting-title><div.icon-area/> 通用<!--v-if--></div>，要改 icon-area 后面的文本节点；
        // 以前改的是 childNodes[1]（icon-area），标题会变成「琉璃通用」。离开时还原，Vue 在值没变时不会重绘它。
        const titleText = [...title.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
        if (titleText) {
          if (titleSaved === null) titleSaved = titleText.nodeValue;
          titleNode = titleText;
          titleText.nodeValue = ' 琉璃';
        }
        tab.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-item-active'));
        nav.classList.add('nav-item-active');
      });
      tab.addEventListener('click', e => {
        const item = e.target.closest && e.target.closest('.nav-item');
        if (item) navigationSequence++;
        if (item && item !== nav) {
          view.style.display = 'none';
          original.style.display = 'block';
          // #63：克隆出来的导航项 QQ 不管，切到别的页时要自己去掉选中态，否则两项同时高亮
          nav.classList.remove('nav-item-active');
          // 点回进入插件页之前的同一项时路由没变，Vue 不会重绘选中态，这里补上；
          // 之后 Vue 重绘这一项会整体改写 className，不会冲突
          const restoreTicket = navigationSequence;
          requestAnimationFrame(() => {
            if (restoreTicket !== navigationSequence) return;
            if (!tab.querySelector('.nav-item.nav-item-active')) item.classList.add('nav-item-active');
          });
          if (titleNode && titleSaved !== null && titleNode.isConnected) titleNode.nodeValue = titleSaved;
          titleNode = null;
          titleSaved = null;
        }
      }, true);
    };
    tick();
  }
  if (location.hash.indexOf('#/setting') === 0) mountLiuliSettingsPage();
})();
