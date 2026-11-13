(() => {
  window.__liuliSwitchMotionGuard?.dispose();
  let pending = null;
  let timer = 0;
  const title = () => document.querySelector('.aio .chat-header .panel-header__title')?.textContent || '';
  function peerKey(area = document.querySelector('.chat-msg-area')) {
    if (window.__liuliSwitchMotion?.peerKey) return window.__liuliSwitchMotion.peerKey(area);
    let key = '';
    for (const message of area?.querySelectorAll('.message') || []) {
      if (message.closest('.viewport-list__measure')) continue;
      const record = window.LiuliQQ?.messageRecord(message);
      const peer = record && (record.peerUid || record.peerUin);
      if (!peer || record.chatType == null) continue;
      const next = String(record.chatType) + ':' + String(peer);
      if (key && next !== key) return '';
      key = next;
    }
    return key;
  }

  function clear() {
    pending = null;
    clearTimeout(timer);
  }
  function pointerdown(event) {
    const item = event.target.closest?.('.recent-contact-item');
    if (event.button !== 0 || !item || item.closest('.viewport-list__measure') ||
      item.classList.contains('recent-contact-item--selected')) return;
    if (item.querySelector(':scope > .liuli-pin-heading') && event.clientY - item.getBoundingClientRect().top <= 28) return;
    clear();
    const area = document.querySelector('.chat-msg-area');
    pending = { title: title(), peer: peerKey(area), area };
    timer = setTimeout(clear, 1600);
  }
  function finishMessageExit(area) {
    if (!area?.hasAttribute('data-ll-switching')) return;
    for (const animation of area.getAnimations()) {
      const effect = animation.effect;
      const timing = effect?.getTiming();
      const frames = effect?.getKeyframes();
      // Only finish the switch controller's 120ms held exit. Never cancel a
      // message entry, new-message animation, or another module's animation.
      if (timing?.duration !== 120 || timing.fill !== 'forwards' || frames?.length !== 2 ||
        Number(frames[0].opacity) !== 1 || Number(frames[1].opacity) !== 0 ||
        frames[1].transform !== 'translateY(-6px)') continue;
      try { animation.finish(); } catch (_) {}
    }
  }
  function anchorExit() {
    const area = pending?.area;
    if (!area?.hasAttribute('data-ll-switching')) return;
    for (const animation of area.getAnimations()) {
      const timing = animation.effect?.getTiming();
      const frames = animation.effect?.getKeyframes();
      if (!animation.pending || timing?.duration !== 120 || timing.fill !== 'forwards' ||
        frames?.length !== 2 || Number(frames[0].opacity) !== 1 || Number(frames[1].opacity) !== 0 ||
        frames[1].transform !== 'translateY(-6px)') continue;
      // A renderer already running the older index.js closure gets the same
      // resolved start time as a fresh document, without replacing its listeners.
      animation.startTime = document.timeline.currentTime;
    }
  }
  const observer = new MutationObserver(() => {
    if (!pending) return;
    const peer = peerKey();
    if (title() === pending.title && (!peer || peer === pending.peer)) return;
    const oldArea = pending.area;
    const area = document.querySelector('.chat-msg-area');
    // A pending WAAPI exit can otherwise start after QQ has already replaced
    // the messages. Finish it before that replacement can be painted.
    finishMessageExit(oldArea);
    if (area !== oldArea && oldArea?.hasAttribute('data-ll-switching')) {
      area?.setAttribute('data-ll-switching', '');
      window.__liuliSwitchMotion?.holdArea(area);
    }
    if (area !== oldArea) finishMessageExit(area);
    clear();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('pointerdown', pointerdown, { capture: true, passive: true });
  window.addEventListener('pointerdown', anchorExit, { passive: true });
  document.addEventListener('visibilitychange', clear);
  window.__liuliSwitchMotionGuard = { dispose() {
    clear();
    observer.disconnect();
    window.removeEventListener('pointerdown', pointerdown, true);
    window.removeEventListener('pointerdown', anchorExit);
    document.removeEventListener('visibilitychange', clear);
    delete window.__liuliSwitchMotionGuard;
  } };
})();
