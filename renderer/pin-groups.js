/* ============================================================
 * 琉璃 · 置顶会话独立分组（issue #55）
 * ------------------------------------------------------------
 * 为什么单独成文件：虚拟列表会反复重建、复用行节点，分组标记只能自己
 * 盯着 DOM 才能跟上；写进 index.js 会和设置面板、动效、诊断互相牵扯。
 * 对外只暴露 window.__liuliPinGroups = { apply, clear }。
 *
 * 实测到的列表结构（QQ 9.9.36）：
 *   .recent-contact
 *     .list-toggler
 *       .q-scroll-view.scroll-view--memory   ← scrollTop 在这里
 *         .viewport-list
 *           .viewport-list__measure          固定定位，里面也有一份行，忽略
 *           .viewport-list__placeholder      上占位：滚到列表顶部时高度 0
 *           .viewport-list__inner            当前渲染的行，都是它的直接子元素
 *           .viewport-list__placeholder      下占位
 *
 * 置顶行带 .recent-contact-item--top，永远排在整个列表最前面。
 * 真实的第一行必须同时满足：它是 inner 的第一个子元素，且紧挨 inner
 * 前面的上占位高度 < 1px。列表滚下去以后 inner 的第一行只是「当前窗口
 * 的第一行」，上占位会变高，这时不能标 first，否则组卡片的圆角和小标题
 * 会跟着滚动位置乱跳。
 *
 * QQ 的 uniform viewport 只测隐藏 measure 行（64px），不能在真实
 * 首行额外加 28px。标题高度由 viewport-list 的固定 padding 保留，
 * 首行卸载后也不撤掉，所以展开时每条会话位置始终是 28 + index*64。
 * 折叠仍属于非等高行投影，尚不能保证原生 range/占位完全匹配。
 * ============================================================ */
(() => {
  'use strict';
  const previous = window.__liuliPinGroups;
  if (previous?.dispose) previous.dispose();
  else previous?.clear();

  const PIN = 'data-liuli-pin';
  const COUNT = 'data-liuli-pin-count';
  const PREFIX = 'data-liuli-pin-prefix';
  const TOGGLE_MS = 180;
  const TOGGLE_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const ROW_PROPS = ['height', 'min-height', 'max-height', 'padding-top', 'padding-bottom',
    'margin-top', 'margin-bottom', 'box-sizing', 'overflow', 'transition'];
  let toggleMotion = null;
  const HEAD_H = 28; // 小标题占的行顶部高度，和 pin-groups.css 保持一致

  // 当前配置。onToggleCollapsed 由 index.js 注入：回调里写回设置并重新 apply。
  const opts = {
    group: false,
    color: false,
    collapsed: false,
    onToggleCollapsed: null
  };

  let root = null; // .recent-contact
  let inner = null; // .viewport-list__inner
  let scroller = null; // .q-scroll-view（滚动事件源）
  let observer = null; // 挂在 root 上，inner 被替换时也能自己重挂
  let frame = 0; // requestAnimationFrame 节流句柄
  let resizeObserver = null;
  const resizeTargets = new Set();
  let fullRefresh = false;
  let surfaceRun = [], surfaceFirst = false, surfaceComplete = false;
  const surfaceStyles = new WeakMap();

  function rememberStyle(node, properties) {
    return properties.map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
  }

  function restoreStyle(node, properties) {
    for (const [name, value, priority] of properties) {
      if (value) node.style.setProperty(name, value, priority);
      else node.style.removeProperty(name);
    }
  }

  function stopToggleMotion() {
    const state = toggleMotion;
    if (!state) return;
    toggleMotion = null;
    clearTimeout(state.timer);
    for (const entry of state.rows) {
      entry.node.style.setProperty('transition', 'none', 'important');
      restoreStyle(entry.node, entry.style.filter(([name]) => name !== 'transition'));
      for (const content of entry.content) {
        content.node.style.setProperty('transition', 'none', 'important');
        restoreStyle(content.node, content.style.filter(([name]) => name !== 'transition'));
      }
    }
    if (state.heading) {
      state.heading.node.style.cssText = state.heading.style;
      state.heading.parent.insertBefore(state.heading.node,
        state.heading.next?.parentNode === state.heading.parent ? state.heading.next : null);
    }
    state.root.removeAttribute('data-liuli-pin-motion');
    // Commit the final CSS geometry while transitions remain disabled. Restoring
    // their native declarations in the same style update can otherwise leave a
    // canceled height interpolation on the paint surface for one more frame.
    state.root.getBoundingClientRect();
    for (const entry of state.rows) {
      restoreStyle(entry.node, entry.style.filter(([name]) => name === 'transition'));
      for (const content of entry.content)
        restoreStyle(content.node, content.style.filter(([name]) => name === 'transition'));
    }
    // An interrupted transition can finish without another ResizeObserver
    // delivery (its content box may already be zero). Snap the paint surface
    // to the final collapsed/expanded geometry before the next refresh.
    if (root?.isConnected) syncSurface(surfaceRun, surfaceFirst, surfaceComplete);
    schedule();
  }

  function captureToggleRows() {
    if (!inner?.isConnected || !root?.isConnected) return null;
    const rows = [...inner.children].filter(row => row.hasAttribute(PIN));
    if (!rows.some(row => ['first', 'single'].includes(row.getAttribute(PIN)))) return null;
    return rows.map(node => {
      const height = node.getBoundingClientRect().height;
      const css = getComputedStyle(node);
      return { node, height,
        top: height ? parseFloat(css.paddingTop) : 0,
        bottom: height ? parseFloat(css.paddingBottom) : 0,
        marginTop: height ? parseFloat(css.marginTop) : 0,
        // A zero-height intermediate row separates the neighboring margins.
        // Remove the header's duplicate bottom gap while hidden rows reappear.
        marginBottom: height && !(opts.collapsed && !toggleMotion) ? parseFloat(css.marginBottom) : 0,
        content: [...node.children].filter(child => !child.classList.contains('liuli-pin-heading')).map(child => ({
          node: child, opacity: height && getComputedStyle(child).display !== 'none' ? getComputedStyle(child).opacity : '0'
        })) };
    });
  }

  function animateToggle(before) {
    if (!before?.length || reducedMotion.matches || document.hidden) return;
    // Measure the real rows at their natural expanded sizes for this local
    // animation. The native uniform virtualizer does not remeasure each row.
    dropAttr(root, 'data-liuli-pin-collapsed');
    recompute();
    if (before.some(entry => entry.node.parentElement !== inner)) { reflectAttrs(); return; }
    const state = { root, rows: [], timer: 0, heading: null };
    for (const entry of before) {
      const node = entry.node;
      const css = getComputedStyle(node);
      const first = ['first', 'single'].includes(node.getAttribute(PIN));
      const target = opts.collapsed ? {
        height: first ? 8 : 0, top: 0, bottom: first ? 8 : 0, marginTop: first ? parseFloat(css.marginTop) : 0,
        marginBottom: 0
      } : { height: node.getBoundingClientRect().height, top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom),
        marginTop: parseFloat(css.marginTop), marginBottom: parseFloat(css.marginBottom) };
      state.rows.push({ ...entry, target, style: rememberStyle(node, ROW_PROPS),
        content: entry.content.map(content => ({ ...content, style: rememberStyle(content.node, ['opacity', 'transition']) })) });
    }
    // The header occupies the fixed prefix above its row. Lift only our own
    // header during row clipping; native rows and listeners stay in place.
    const headerRow = state.rows.find(entry => ['first', 'single'].includes(entry.node.getAttribute(PIN)))?.node;
    const heading = headerRow?.querySelector(':scope > .liuli-pin-heading');
    if (heading) {
      state.heading = { node: heading, parent: heading.parentNode, next: heading.nextSibling,
        row: headerRow, style: heading.style.cssText };
      root.appendChild(heading);
    }
    toggleMotion = state;
    setAttr(root, 'data-liuli-pin-motion', '');
    reflectAttrs();
    const write = (node, values) => {
      for (const [name, value] of Object.entries(values)) node.style.setProperty(name, value, 'important');
    };
    const dimensions = entry => ({ height: entry.height + 'px', 'padding-top': entry.top + 'px',
      'padding-bottom': entry.bottom + 'px', 'margin-top': entry.marginTop + 'px', 'margin-bottom': entry.marginBottom + 'px' });
    for (const entry of state.rows) {
      write(entry.node, { transition: 'none', 'box-sizing': 'border-box', 'min-height': '0', 'max-height': 'none',
        overflow: 'clip', ...dimensions(entry) });
      for (const content of entry.content) write(content.node, { transition: 'none', opacity: content.opacity });
    }
    // Establish current sizes before setting the targets. Reversing a toggle
    // starts at the current interpolation, and the browser advances each frame.
    root.getBoundingClientRect();
    syncSurface(surfaceRun, surfaceFirst, surfaceComplete);
    const transition = ['height', 'padding-top', 'padding-bottom', 'margin-top', 'margin-bottom']
      .map(name => name + ' ' + TOGGLE_MS + 'ms ' + TOGGLE_EASE).join(',');
    for (const entry of state.rows) {
      write(entry.node, { transition, ...dimensions(entry.target) });
      for (const content of entry.content) write(content.node, {
        transition: 'opacity ' + TOGGLE_MS + 'ms ' + TOGGLE_EASE, opacity: opts.collapsed ? '0' : '1'
      });
    }
    state.timer = setTimeout(stopToggleMotion, TOGGLE_MS + 34);
  }

  function isPinRow(node) {
    return (
      !!node &&
      node.nodeType === 1 &&
      node.classList.contains('recent-contact-item') &&
      node.classList.contains('recent-contact-item--top')
    );
  }

  function rowOf(node) {
    return node && node.closest ? node.closest('.recent-contact-item') : null;
  }

  function setAttr(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  function dropAttr(node, name) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  }

  /* 同一会话可能被虚拟列表同时渲染两份（例如切换会话的过渡帧），
   * 「置顶 · N」里的 N 要按 data-contact-id 去重，不能数 DOM 行数。 */
  function countConversations(run) {
    const seen = new Set();
    for (let i = 0; i < run.length; i++) {
      const id = run[i].getAttribute('data-contact-id');
      seen.add(id || 'row-' + i);
    }
    return seen.size;
  }

  /* 上占位高度 < 1px 才说明这一屏是从列表最顶上开始的。
   * 没有占位节点（结构变了）就按「不是第一行」处理，宁可不画圆角，
   * 也不要在滚动中途把小组头像切掉一半。 */
  function placeholderHeight(node, measurements) {
    if (measurements.has(node)) return measurements.get(node);
    const height = node.getBoundingClientRect().height;
    measurements.set(node, height);
    return height;
  }

  function atListTop(cur, measurements) {
    const prev = cur.previousElementSibling;
    if (!prev || !prev.classList.contains('viewport-list__placeholder')) return false;
    return placeholderHeight(prev, measurements) < 1;
  }

  function clearMarks(scope = root) {
    if (!scope) return;
    const nodes = scope.querySelectorAll('[data-liuli-pin], [data-liuli-pin-count]');
    for (const node of nodes) {
      node.removeAttribute(PIN);
      node.removeAttribute(COUNT);
    }
    scope.querySelectorAll('.liuli-pin-heading, .liuli-pin-surface').forEach(node => node.remove());
    surfaceRun = [];
    surfaceFirst = surfaceComplete = false;
  }
  function clearRoot(scope) {
    if (!scope) return;
    scope.removeAttribute('data-liuli-pin-color');
    scope.removeAttribute('data-liuli-pin-collapsed');
    scope.removeAttribute('data-liuli-pin-motion');
    scope.removeAttribute(PREFIX);
    clearMarks(scope);
  }

  function syncHeader(row, role, countText) {
    let header = toggleMotion?.heading?.row === row ? toggleMotion.heading.node : row.querySelector(':scope > .liuli-pin-heading');
    if (role !== 'first' && role !== 'single') {
      if (header) header.remove();
      return;
    }
    if (!header) {
      header = document.createElement('div');
      header.className = 'liuli-pin-heading';
      header.setAttribute('role', 'button');
      header.tabIndex = 0;
      row.appendChild(header);
    }
    const text = '置顶 · ' + countText;
    if (header.textContent !== text) header.textContent = text;
    setAttr(header, 'aria-expanded', opts.collapsed ? 'false' : 'true');
    setAttr(header, 'aria-label', (opts.collapsed ? '展开' : '折叠') + '置顶会话');
  }

  function recompute(measurements = new Map()) {
    if (!root || !root.isConnected) {
      unbind();
      clearRoot(root);
      root = null;
      inner = null;
      return;
    }
    const nextInner = root.querySelector('.viewport-list__inner');
    if (toggleMotion && toggleMotion.rows.some(entry => entry.node.parentElement !== nextInner || !isPinRow(entry.node))) {
      stopToggleMotion();
      measurements.clear();
    }
    if (nextInner !== inner) inner = nextInner;
    // 滚动容器可能比 inner 晚出现（或者被整体替换），每次重算顺手校一次。
    bindScroll();
    if (!inner) {
      syncResize();
      clearMarks();
      return;
    }

    const rows = Array.prototype.slice.call(inner.children);
    const run = [];
    for (let i = 0; i < rows.length; i++) {
      if (!isPinRow(rows[i])) break; // 置顶行永远是一段连续前缀，遇到普通行就停
      run.push(rows[i]);
    }

    const realFirst = run.length > 0 && rows[0] === run[0] && atListTop(inner, measurements);
    const measuredFirst = root.querySelector('.viewport-list__measure .recent-contact-item');
    // Keep the prefix while the top row is outside the rendered window. Only
    // an actual top-of-list with no pins may establish that it is unnecessary.
    if (run.length || isPinRow(measuredFirst)) setAttr(root, PREFIX, '1');
    else if (atListTop(inner, measurements)) dropAttr(root, PREFIX);
    const count = countConversations(run);
    const afterRun = run.length ? run[run.length - 1].nextElementSibling : null;
    const bottomSpace = inner.nextElementSibling;
    const completeRun = !!(afterRun && afterRun.classList.contains('recent-contact-item') &&
      !afterRun.classList.contains('recent-contact-item--top')) ||
      (!afterRun && bottomSpace && bottomSpace.classList.contains('viewport-list__placeholder') &&
        placeholderHeight(bottomSpace, measurements) < 1);
    // 虚拟列表没渲染出组尾时只能确认下限，不能把首屏数量当成全部置顶数量。
    const countText = String(count) + (completeRun ? '' : '+');

    /* 先算出每行该是什么角色：
     *   first / single  只有真正的列表第一行才配拥有（小标题 + 上圆角）
     *   mid             组中间：只有底色
     *   last            组的真实末行：下圆角 + 和普通会话之间的间隔
     * 看不到组尾（inner 被虚拟列表截断）时一律 mid，避免圆角画在半截上。 */
    const values = new Map();
    if (run.length) {
      values.set(run[0], realFirst ? (run.length === 1 && completeRun ? 'single' : 'first') : 'mid');
      for (let i = 1; i < run.length; i++) values.set(run[i], 'mid');
      const tail = run[run.length - 1];
      const endsHere = completeRun;
      if (endsHere && run.length > 1) values.set(tail, 'last');
    }

    // inner 里的每一行都要过一遍：被复用成普通会话的旧置顶行必须清干净。
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const value = values.get(row);
      if (!value) {
        dropAttr(row, PIN);
        dropAttr(row, COUNT);
        syncHeader(row, '', '');
        continue;
      }
      setAttr(row, PIN, value);
      syncHeader(row, value, countText);
      if (value === 'first' || value === 'single') setAttr(row, COUNT, countText);
      else dropAttr(row, COUNT);
    }
    syncResize(run);
    surfaceRun = run;
    surfaceFirst = realFirst;
    surfaceComplete = completeRun;
    syncSurface(run, realFirst, completeRun);
  }

  // 整组只铺一层底，不能每行向外扩 2px 再叠半透明色，否则接缝会变成横线。
  function syncSurface(run, realFirst, completeRun) {
    let surface = root.querySelector(':scope > .liuli-pin-surface');
    const candidates = opts.collapsed && !toggleMotion ? run.slice(0, 1) : run;
    const rects = new Map();
    const rectOf = node => {
      if (!rects.has(node)) rects.set(node, node.getBoundingClientRect());
      return rects.get(node);
    };
    let first, last;
    for (const row of candidates) {
      const rect = rectOf(row);
      if (rect.height > 0) { first = rect; break; }
    }
    for (let i = candidates.length - 1; first && i >= 0; i--) {
      const rect = rectOf(candidates[i]);
      if (rect.height > 0) { last = rect; break; }
    }
    if (!first || !last) {
      if (surface) surface.remove();
      return;
    }
    const host = rectOf(root);
    const viewport = scroller ? rectOf(scroller) : host;
    let headingCss;
    if (toggleMotion?.heading) {
      const { row } = toggleMotion.heading;
      const rect = rectOf(row), top = rect.top - HEAD_H;
      const clipTop = Math.max(0, viewport.top - top), clipBottom = Math.max(0, top + HEAD_H - viewport.bottom);
      headingCss = 'position:absolute;top:' + (top - host.top) + 'px;left:' + (rect.left - host.left + 12) +
        'px;right:' + (host.right - rect.right + 12) + 'px;display:flex;clip-path:inset(' + clipTop + 'px 0 ' + clipBottom + 'px 0);';
    }
    // Finish all geometry reads before adding/styling our absolute paint nodes.
    // A one-row/collapsed group and its moving header reuse the same row rect.
    if (!surface) {
      surface = document.createElement('div');
      surface.className = 'liuli-pin-surface';
      surface.setAttribute('aria-hidden', 'true');
      root.appendChild(surface);
    }
    if (headingCss !== undefined) toggleMotion.heading.node.style.cssText = headingCss;
    // 底板是滚动容器外的兄弟节点，必须主动裁到可视区，不能滚到搜索框后面。
    const firstTop = first.top - (realFirst && root.hasAttribute(PREFIX) ? HEAD_H : 0);
    const top = Math.max(firstTop, viewport.top);
    const bottom = Math.min(last.bottom, viewport.bottom);
    if (bottom <= top) {
      if (surface.style.display !== 'none') surface.style.display = 'none';
      surfaceStyles.delete(surface);
      return;
    }
    const roundTop = realFirst && firstTop >= viewport.top;
    const roundBottom = (completeRun || opts.collapsed) && last.bottom <= viewport.bottom;
    const radius = (roundTop ? '12px 12px ' : '0 0 ') + (roundBottom ? '12px 12px' : '0 0');
    const css = 'display:block;left:' + (first.left - host.left) + 'px;top:' + (top - host.top) +
      'px;width:' + first.width + 'px;height:' + (bottom - top) + 'px;border-radius:' + radius + ';';
    // cssText serializes with different whitespace than the source string.
    // Comparing those forms wrote an identical style on every scroll/refresh.
    if (surfaceStyles.get(surface) !== css) {
      surface.style.cssText = css;
      surfaceStyles.set(surface, css);
    }
  }

  function schedule() {
    fullRefresh = true;
    scheduleSurface();
  }

  function scheduleSurface() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        const refresh = fullRefresh;
        fullRefresh = false;
        // This snapshot lives for this synchronous refresh only. Native style,
        // scrolling, transforms and a replacement inner are measured afresh.
        const measurements = new Map();
        if (refresh || !root?.isConnected || !inner?.isConnected ||
          (surfaceRun.length > 0 && atListTop(inner, measurements) !== surfaceFirst)) recompute(measurements);
        else syncSurface(surfaceRun, surfaceFirst, surfaceComplete);
      } catch (e) {}
    });
  }

  /* 折叠小标题：点在标题带里的 mousedown / mouseup / click 全部在捕获阶段
   * 截住，QQ 的「打开会话」拿不到事件，就不会跳转。点在行的其他位置照常。 */
  function inHeadBand(event) {
    const heading = event.target.closest?.('.liuli-pin-heading');
    if (heading && root?.contains(heading)) return heading;
    const row = rowOf(event.target);
    if (!row) return null;
    const role = row.getAttribute(PIN);
    if (role !== 'first' && role !== 'single') return null;
    const rect = row.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < -HEAD_H || y >= 0) return null;
    return row;
  }

  function onGuard(event) {
    if (!opts.group) return;
    if (!inHeadBand(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'click') return;
    if (typeof opts.onToggleCollapsed === 'function') opts.onToggleCollapsed(!opts.collapsed);
  }

  function onHeaderKey(event) {
    if (!event.target.classList.contains('liuli-pin-heading') ||
        (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof opts.onToggleCollapsed === 'function') opts.onToggleCollapsed(!opts.collapsed);
  }

  function bindScroll() {
    const next = root.querySelector('.q-scroll-view') || root;
    if (scroller === next) return;
    if (scroller) scroller.removeEventListener('scroll', scheduleSurface);
    scroller = next;
    if (scroller) scroller.addEventListener('scroll', scheduleSurface, { passive: true });
  }

  function reflectAttrs() {
    if (!root) return;
    if (opts.color) setAttr(root, 'data-liuli-pin-color', '1');
    else dropAttr(root, 'data-liuli-pin-color');
    if (opts.collapsed) setAttr(root, 'data-liuli-pin-collapsed', '1');
    else dropAttr(root, 'data-liuli-pin-collapsed');
  }

  function syncResize(run = []) {
    if (!resizeObserver) resizeObserver = new ResizeObserver(scheduleSurface);
    // 列宽拖动不触发 window.resize；也观察滚动视口和置顶行的实际尺寸。
    // 不观察自绘底板，避免写回其宽高后再次触发自身。
    const next = new Set([root, scroller, ...run].filter(Boolean));
    for (const node of resizeTargets) {
      if (!next.has(node)) {
        resizeObserver.unobserve(node);
        resizeTargets.delete(node);
      }
    }
    for (const node of next) {
      if (resizeTargets.has(node)) continue;
      resizeObserver.observe(node);
      resizeTargets.add(node);
    }
  }

  function bindRoot() {
    if (!root) return;
    root.addEventListener('mousedown', onGuard, true);
    root.addEventListener('mouseup', onGuard, true);
    root.addEventListener('click', onGuard, true);
    root.addEventListener('keydown', onHeaderKey, true);
    window.addEventListener('resize', schedule);
    if (!observer) {
      // 同时盯 childList 和 class：行被复用、置顶/取消置顶、inner 被整体
      // 换掉（切换账号、列表重建）都会走到这里；我们只写 data-* 属性，
      // 不在 class 过滤范围内，不会自己触发自己。
      observer = new MutationObserver(records => {
        const ownNode = node => node.nodeType === 1 && node.matches('.liuli-pin-heading, .liuli-pin-surface');
        if (records.some(record => !ownNode(record.target) && (record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(node => !ownNode(node))))) schedule();
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  function unbind() {
    stopToggleMotion();
    window.removeEventListener('resize', schedule);
    if (root) {
      root.removeEventListener('mousedown', onGuard, true);
      root.removeEventListener('mouseup', onGuard, true);
      root.removeEventListener('click', onGuard, true);
      root.removeEventListener('keydown', onHeaderKey, true);
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    resizeTargets.clear();
    if (scroller) {
      scroller.removeEventListener('scroll', scheduleSurface);
      scroller = null;
    }
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    fullRefresh = false;
  }

  function mount() {
    const next = document.querySelector('.recent-contact');
    if (next !== root || !root || !root.isConnected) {
      unbind();
      // QQ 可能保留旧列表节点供稍后复用，移出文档后也必须恢复其原状。
      clearRoot(root);
      root = next;
      inner = null;
    }
    if (!root) return false;
    reflectAttrs();
    bindScroll();
    bindRoot();
    return true;
  }

  function apply(options) {
    const animate = options && opts.group && options.group !== false && root?.isConnected &&
      typeof options.collapsed === 'boolean' && options.collapsed !== opts.collapsed;
    const previousRoot = root;
    const before = animate ? captureToggleRows() : null;
    if (animate) stopToggleMotion();
    if (options) Object.assign(opts, options);
    // group 关掉等同于 clear：不监听、不留标记，列表恢复 QQ 原样。
    if (!opts.group) {
      clear();
      return;
    }
    // 列表还没渲染出来时不要白挂监听：index.js 的结构观察者会在
    // .recent-contact 出现后再调一次 apply。
    if (!mount()) return;
    try {
      recompute();
      if (before && root === previousRoot) animateToggle(before);
    } catch (e) {}
  }

  function clear() {
    opts.group = false;
    unbind();
    clearRoot(root);
    root = null;
    inner = null;
  }

  const onMotionPreference = () => { if (reducedMotion.matches) stopToggleMotion(); };
  reducedMotion.addEventListener('change', onMotionPreference);
  window.__liuliPinGroups = { apply, clear, dispose() {
    clear();
    reducedMotion.removeEventListener('change', onMotionPreference);
  } };
})();
