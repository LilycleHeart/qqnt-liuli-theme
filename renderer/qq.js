(() => {
  window.__liuliSidebarShortcuts?.dispose();
  const messages = new WeakMap();
  const messageSequenceOwners = new WeakMap();
  let profileStore;

  // QQ's production Vue roots expose vnodes, but not LiteLoader's __VUE__ field.
  function visitComponents(element, visit) {
    for (let root = element; root; root = root.parentElement) {
      if (!root._vnode) continue;
      const stack = [root._vnode];
      const seen = new Set();
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

  function messageRecord(element) {
    const message = element?.closest('.message');
    if (!message) return null;
    const cached = messages.get(message);
    if (cached && !cached.isUnmounted) return cached.props.msgRecord;
    visitComponents(message, component => {
      const record = component.props?.msgRecord;
      const node = component.vnode.el;
      const owner = node?.nodeType === 1 ? node.closest('.message') : null;
      if (record && owner) messages.set(owner, component);
      return record && owner === message;
    });
    return messages.get(message)?.props.msgRecord || null;
  }

  function messagePeer(record) {
    const peer = record && (record.peerUid || record.peerUin);
    return peer && record.chatType != null ? String(record.chatType) + ':' + String(peer) : '';
  }

  // QQ's exposed msgs is the complete loaded sequence; curMsgs contains only
  // the current virtual window. Read the former without calling host methods
  // or changing its height/position cache. Never rely on debugger-only __VUE__.
  function loadedMessageSequence(element) {
    const area = element?.closest?.('.chat-msg-area');
    const list = area?.querySelector('.chat-msg-area__vlist');
    if (!list) return null;
    const arrayOf = component => {
      const value = component?.exposed?.msgs;
      return Array.isArray(value) ? value : Array.isArray(value?.value) ? value.value : null;
    };
    const suitable = component => !component?.isUnmounted && component?.props?.dataKey === 'msgId' &&
      component.vnode?.el === list && arrayOf(component) !== null;
    let owner = messageSequenceOwners.get(list);
    if (!suitable(owner)) {
      owner = null;
      visitComponents(list, component => {
        if (!suitable(component)) return false;
        owner = component;
        return true;
      });
      if (!owner) return null;
      messageSequenceOwners.set(list, owner);
    }
    const entries = arrayOf(owner).map(item => {
      const id = item?.msgId == null ? String(item?.id || '') : String(item.msgId);
      const record = item?.data;
      // Keep malformed/system placeholders in position as barriers. Filtering
      // them out would invent adjacency across an unknown native row.
      return { id, record: id && record && String(record.msgId) === id ? record : null };
    });
    const indices = new Map();
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i].id;
      if (id) indices.set(id, indices.has(id) ? -1 : i);
    }
    return { entries, neighbors(record) {
      const id = record?.msgId == null ? '' : String(record.msgId);
      const index = indices.get(id);
      if (index == null || index < 0) return null;
      const current = entries[index].record;
      if (!current || (current !== record && (!messagePeer(record) ||
        messagePeer(current) !== messagePeer(record) ||
        String(current.senderUid || current.senderUin || '') !== String(record.senderUid || record.senderUin || '')))) return null;
      return { previous: entries[index - 1]?.record || null, next: entries[index + 1]?.record || null };
    } };
  }

  function selfUid() {
    if (profileStore?.selfProfileInfo?.uid) return String(profileStore.selfProfileInfo.uid);
    visitComponents(document.querySelector('.topbar-profile'), component => {
      const serviceContainer = component.setupState?.qq_container__vue;
      const bindings = serviceContainer?.container?._bindingDictionary?._map;
      if (!bindings) return false;
      // Read already-created services; never instantiate or call QQ services.
      for (const group of bindings.values()) {
        for (const binding of group) {
          if (binding.cache?.selfProfileInfo?.uid) {
            profileStore = binding.cache;
            return true;
          }
        }
      }
      return false;
    });
    return profileStore?.selfProfileInfo?.uid ? String(profileStore.selfProfileInfo.uid) : '';
  }

  function contactType(item) {
    const avatar = item?.querySelector('.avatar, .avatar-native');
    if (!avatar) return null;
    let type = null;
    // Use QQ's existing Vue tree; the debugger's __VUE__ mapping is absent in a
    // normal cold launch and must not determine whether transitions work.
    visitComponents(avatar, component => {
      const props = component.props;
      const node = component.vnode?.el;
      if (!props?.uid || ![1, 2].includes(props.type) || node?.nodeType !== 1 ||
        node.closest('.recent-contact-item') !== item ||
        !(node === avatar || node.contains(avatar) || avatar.contains(node))) return false;
      type = props.type;
      return true;
    });
    return type;
  }

  let shortcutComponent;
  const SHORTCUTS_KEY = 'liuli-sidebar-shortcuts';
  const shortcutStates = new Map();
  const shortcutPinsOriginal = new Map();
  let shortcutsEnabled = false;
  let shortcutFrame = 0;
  function shortcutOwner() {
    const anchor = document.querySelector('.sidebar__menu .func-menu-more-component .icon-item');
    if (!anchor) return null;
    const suitable = component => {
      const node = component.vnode?.el;
      return component.ctx?.switchHMenuItem && component.setupState?.allMenuConfig &&
        node?.nodeType === 1 && node.contains(anchor);
    };
    if (!shortcutComponent || shortcutComponent.isUnmounted || !suitable(shortcutComponent)) {
      shortcutComponent = null;
      // 仅使用已存在的渲染组件；不写 QQ 的账户配置，也不调用持久化服务。
      for (let c = anchor.__VUE__?.[0]; c; c = c.parent) {
        if (suitable(c)) { shortcutComponent = c; break; }
      }
      if (!shortcutComponent) visitComponents(anchor, c => {
        if (!suitable(c)) return false;
        shortcutComponent = c;
        return true;
      });
    }
    return shortcutComponent;
  }

  function replaceItems(array, next) {
    if (array.length === next.length && array.every((item, i) => item.id === next[i].id)) return false;
    array.splice(0, array.length, ...next);
    return true;
  }
  function shortcutPins(state) {
    try {
      const saved = JSON.parse(localStorage.getItem(SHORTCUTS_KEY));
      if (Array.isArray(saved)) return [...new Set(saved)].filter(id => state.optional.includes(id));
    } catch (_) {}
    return state.originalItems.filter(item => state.optional.includes(item.id)).map(item => item.id);
  }
  function syncShortcuts() {
    shortcutFrame = 0;
    if (!shortcutsEnabled) return;
    for (const [pin, original] of shortcutPinsOriginal) if (!pin.isConnected) {
      restoreShortcutPin(pin, original);
      shortcutPinsOriginal.delete(pin);
    }
    for (const [component, state] of shortcutStates) {
      if (component.isUnmounted || !component.vnode?.el?.isConnected) {
        restoreShortcutState(state);
        shortcutStates.delete(component);
      }
    }
    const component = shortcutOwner();
    const items = component?.ctx?.items;
    const hidden = component?.ctx?.hMenuItems;
    if (!Array.isArray(items) || !Array.isArray(hidden)) return;
    const configs = component.setupState.allMenuConfig;
    let state = shortcutStates.get(component);
    if (!state) {
      // Native QQ already supplies the menu components and their real actions.
      // Only lift the single optional slot; never write QQ's account preference.
      const optional = component.ctx.getSideBarMenuItems([]).filter(id => configs[id]);
      if (!optional.length) return;
      state = { component, optional, originalItems: [...items], originalHidden: [...hidden],
        itemArrays: new Set(), hiddenArrays: new Set() };
      shortcutStates.set(component, state);
    }
    state.itemArrays.add(items);
    state.hiddenArrays.add(hidden);
    const pins = shortcutPins(state);
    const fixed = state.originalItems.filter(item => !state.optional.includes(item.id));
    const changedItems = replaceItems(items, [...pins.map(id => configs[id]), ...fixed]);
    // Keep all existing native pin buttons available, including already pinned
    // entries, so the same button can remove an entry without another settings UI.
    const changedHidden = replaceItems(hidden, state.optional.map(id => configs[id]));
    if (changedItems || changedHidden) component.proxy?.$forceUpdate();
    for (const row of document.querySelectorAll('.more-h-menu-item')) {
      const label = row.querySelector('.func-menu-label')?.textContent.trim();
      const id = state.optional.find(id => configs[id].label === label);
      const pin = row.querySelector('.more-h-menu-pin');
      if (id === undefined || !pin) continue;
      if (!shortcutPinsOriginal.has(pin)) shortcutPinsOriginal.set(pin, {
        role: pin.getAttribute('role'), label: pin.getAttribute('aria-label'),
        pressed: pin.getAttribute('aria-pressed'), use: pin.querySelector('use'),
        href: pin.querySelector('use')?.getAttribute('xlink:href')
      });
      const selected = pins.includes(id);
      pin.setAttribute('role', 'button');
      pin.setAttribute('aria-label', (selected ? '取消固定' : '固定') + label);
      pin.setAttribute('aria-pressed', String(selected));
      const use = pin.querySelector('use');
      const href = '/_upper_/resource/icons/' + (selected ? 'pinned' : 'unpinned') + '_24.svg#' + (selected ? 'pinned' : 'unpinned') + '_24';
      if (use?.getAttribute('xlink:href') !== href) use?.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    }
  }
  function scheduleShortcuts() {
    if (shortcutsEnabled && !shortcutFrame) shortcutFrame = requestAnimationFrame(syncShortcuts);
  }
  function shortcutPinClick(event) {
    if (!shortcutsEnabled || event.button !== 0) return;
    const pin = event.target.closest?.('.more-h-menu-pin');
    if (!pin) return;
    const component = shortcutOwner();
    const state = shortcutStates.get(component);
    if (!state) return;
    const label = pin.closest('.more-h-menu-item')?.querySelector('.func-menu-label')?.textContent.trim();
    const id = state.optional.find(id => component.setupState.allMenuConfig[id].label === label);
    if (id === undefined) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pins = shortcutPins(state);
    const index = pins.indexOf(id);
    if (index < 0) pins.push(id);
    else pins.splice(index, 1);
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(pins));
    syncShortcuts();
  }
  function sidebarShortcutLimit(enabled) {
    shortcutsEnabled = enabled === true;
    document.body.toggleAttribute('data-liuli-shortcuts-unlocked', shortcutsEnabled);
    if (shortcutsEnabled) { syncShortcuts(); return; }
    cancelAnimationFrame(shortcutFrame);
    shortcutFrame = 0;
    for (const state of shortcutStates.values()) restoreShortcutState(state);
    for (const [pin, original] of shortcutPinsOriginal) restoreShortcutPin(pin, original);
    shortcutPinsOriginal.clear();
    shortcutStates.clear();
  }
  function restoreShortcutPin(pin, original) {
    for (const [name, value] of [['role', original.role], ['aria-label', original.label], ['aria-pressed', original.pressed]]) {
      if (value === null) pin.removeAttribute(name);
      else pin.setAttribute(name, value);
    }
    if (original.use) {
      if (original.href === null) original.use.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      else original.use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', original.href);
    }
  }
  function restoreShortcutState(state) {
    for (const array of state.itemArrays) replaceItems(array, state.originalItems);
    for (const array of state.hiddenArrays) replaceItems(array, state.originalHidden);
    if (!state.component.isUnmounted && state.component.vnode?.el?.isConnected) state.component.proxy?.$forceUpdate();
  }
  function configuredShortcuts() {
    try { sidebarShortcutLimit(JSON.parse(localStorage.getItem('liuli-layout') || '{}').unlockSidebarShortcuts === true); }
    catch (_) { sidebarShortcutLimit(false); }
  }
  const shortcutObserver = new MutationObserver(records => {
    if (!shortcutsEnabled) return;
    if (records.some(record => record.target.closest?.('.sidebar__menu, .more-menu') ||
      [...record.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches('.sidebar__menu, .more-menu, .container-sidebar') || node.querySelector('.sidebar__menu, .more-menu'))))) scheduleShortcuts();
  });
  shortcutObserver.observe(document.body, { childList: true, subtree: true });
  function shortcutsStorage(event) {
    if (event.key === 'liuli-layout') configuredShortcuts();
    else if (event.key === SHORTCUTS_KEY) scheduleShortcuts();
  }
  document.addEventListener('click', shortcutPinClick, true);
  window.addEventListener('storage', shortcutsStorage);
  window.__liuliSidebarShortcuts = { apply: sidebarShortcutLimit, dispose() {
    sidebarShortcutLimit(false);
    shortcutObserver.disconnect();
    document.removeEventListener('click', shortcutPinClick, true);
    window.removeEventListener('storage', shortcutsStorage);
    delete window.__liuliSidebarShortcuts;
  } };
  // Compatibility for an already-running older layout closure. Its former
  // favorite/mail replacement must not undo the native menu's expanded slots.
  const sidebarShortcut = () => false;

  window.LiuliQQ = Object.freeze({ messageRecord, loadedMessageSequence, selfUid, contactType, sidebarShortcut, sidebarShortcutLimit });
  configuredShortcuts();
})();
