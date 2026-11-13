(() => {
  'use strict';
  window.__liuliMessageOverscan?.dispose();

  const SELECTOR = '.chat-msg-area__vlist';
  const STRUCTURE = '.chat-msg-area, .chat-msg-area__vlist';
  const MAX_EXTRA = 48;
  const states = new Map();
  const retired = new WeakSet();
  let frame = 0, disposed = false, needsDiscover = false;

  function visitComponents(element, visit) {
    for (let root = element; root; root = root.parentElement) {
      if (!root._vnode) continue;
      const stack = [root._vnode], seen = new Set();
      while (stack.length) {
        const vnode = stack.pop();
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) continue;
        seen.add(vnode);
        const component = vnode.component;
        if (component && !component.isUnmounted) {
          if (visit(component)) return;
          stack.push(component.subTree);
        }
        if (Array.isArray(vnode.children)) stack.push(...vnode.children);
        if (Array.isArray(vnode.dynamicChildren)) stack.push(...vnode.dynamicChildren);
        stack.push(vnode.suspense?.activeBranch);
      }
    }
  }

  function peerOf(item) {
    const data = item?.data, id = item?.msgId ?? item?.id;
    const peer = data && (data.peerUid || data.peerUin);
    return id != null && data && String(data.msgId) === String(id) && peer && data.chatType != null ?
      String(data.chatType) + ':' + String(peer) : '';
  }

  function expandProjection(list, native, viewportHeight) {
    if (!Array.isArray(list) || !Array.isArray(native) || !native.length) return native;
    const first = list.indexOf(native[0]), last = list.indexOf(native[native.length - 1]);
    if (first < 0 || last - first + 1 !== native.length ||
        !native.every((item, index) => item === list[first + index])) return native;
    const peer = peerOf(native[0]);
    if (!peer || !native.every(item => peerOf(item) === peer)) return native;
    const reserve = Math.max(768, Math.min(1800, Math.max(0, viewportHeight) * 1.5));
    const itemHeight = item => Number.isFinite(Number(item?.height)) && Number(item.height) > 0 ? Number(item.height) : 24;
    let from = first, to = last + 1;
    for (let count = 0, pixels = 0; from > 0 && count < MAX_EXTRA && pixels < reserve; count++) {
      const item = list[from - 1];
      if (peerOf(item) !== peer) break;
      pixels += itemHeight(item);
      from--;
    }
    for (let count = 0, pixels = 0; to < list.length && count < MAX_EXTRA && pixels < reserve; count++) {
      const item = list[to];
      if (peerOf(item) !== peer) break;
      pixels += itemHeight(item);
      to++;
    }
    // Only the projection array is new. QQ keeps ownership of every entry,
    // record and measured height/position, and computes its own list padding.
    return from === first && to === last + 1 ? native : list.slice(from, to);
  }

  function suitable(component, list) {
    const exposed = component?.exposed;
    const current = exposed?.curList;
    const descriptor = current && Object.getOwnPropertyDescriptor(current, 'fn');
    return !component?.isUnmounted && component?.vnode?.el === list &&
      component.props?.dataKey === 'msgId' && exposed?.list?.__v_isRef === true &&
      current?.__v_isRef === true && current.__v_isReadonly === true && current.setter === undefined &&
      descriptor?.writable === true && typeof descriptor.value === 'function';
  }

  function restore(state) {
    if (state.computed.fn === state.wrapper) state.computed.fn = state.original;
    states.delete(state.list);
    if (![...states.values()].some(other => other.area === state.area)) resize.unobserve(state.area);
  }

  function bind(list) {
    let state = states.get(list);
    if (state && suitable(state.owner, list) && state.owner.exposed.curList === state.computed &&
        state.computed.fn === state.wrapper) return;
    if (state) {
      if (state.computed.fn !== state.wrapper) retired.add(state.computed);
      restore(state);
    }
    const area = list.closest('.chat-msg-area');
    if (!area) return;
    let owner = null;
    visitComponents(list, component => {
      if (!suitable(component, list) || retired.has(component.exposed.curList)) return false;
      owner = component;
      return true;
    });
    if (!owner) return;
    const computed = owner.exposed.curList;
    state = { list, area, owner, computed, original: computed.fn,
      height: Math.max(0, area.clientHeight || 0), wrapper: null };
    state.wrapper = function (...args) {
      const native = state.original.apply(this, args);
      // Do not invalidate a computed ref, write its cache/flags or force a
      // render. Installation and restoration take effect on QQ's next normal
      // dependency change (usually its next scroll-range update).
      if (disposed || document.hidden || state.height <= 0 || !state.list.isConnected || state.owner.isUnmounted ||
          state.owner.vnode?.el !== state.list || state.owner.exposed.curList !== state.computed ||
          state.list.closest('.chat-msg-area') !== state.area) return native;
      return expandProjection(state.owner.exposed.list.value, native, state.height);
    };
    try { computed.fn = state.wrapper; } catch (_) { return; }
    if (computed.fn !== state.wrapper) return;
    states.set(list, state);
    resize.observe(area);
  }

  function discover() {
    frame = 0;
    if (disposed) return;
    if (document.hidden) { needsDiscover = true; return; }
    needsDiscover = false;
    for (const state of [...states.values()])
      if (!state.list.isConnected || state.owner.isUnmounted) restore(state);
    for (const list of document.querySelectorAll(SELECTOR)) bind(list);
  }

  function schedule() {
    if (disposed) return;
    if (document.hidden) { needsDiscover = true; return; }
    if (!frame) frame = requestAnimationFrame(discover);
  }

  const resize = new ResizeObserver(entries => {
    for (const entry of entries) for (const state of states.values())
      if (entry.target === state.area) state.height = Math.max(0, entry.contentRect.height || 0);
  });
  const observer = new MutationObserver(records => {
    const containsStructure = node => node.nodeType === 1 && (node.matches(STRUCTURE) ||
      (!node.matches('.ml-item,.message,.message-container') && !!node.querySelector(STRUCTURE)));
    if (records.some(record => {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      // Virtual row churn stays local to an existing list. It never requires
      // another scan of the application's component tree.
      if (record.target.closest?.(SELECTOR) && !nodes.some(node => node.nodeType === 1 && node.matches(STRUCTURE))) return false;
      return nodes.some(containsStructure);
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  function onVisibility() { if (!document.hidden && needsDiscover) schedule(); }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('liuli-scope', schedule);
  const api = { refresh: schedule, dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    for (const state of [...states.values()]) restore(state);
    resize.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('liuli-scope', schedule);
    if (window.__liuliMessageOverscan === api) delete window.__liuliMessageOverscan;
  } };
  window.__liuliMessageOverscan = api;
  discover();
})();
