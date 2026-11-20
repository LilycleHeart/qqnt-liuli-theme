(() => {
  window.__liuliVoiceLayout?.dispose();
  let frame = 0;
  const voices = new Set();
  const pending = new Set();
  const selector = '.ptt-element';
  // Retire the old coupling between maximum width and voice's natural size.
  document.body.style.removeProperty('--ll-voice-width-ratio');

  function refresh(roots) {
    if (document.hidden) return;
    const changed = new Set();
    if (!roots) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending.clear();
      for (const voice of document.querySelectorAll('.chat-msg-area .ptt-element')) changed.add(voice);
    } else for (const root of roots) {
      if (!root.isConnected) continue;
      const voice = root.closest?.(selector);
      if (voice) changed.add(voice);
      else for (const voice of root.querySelectorAll(selector)) changed.add(voice);
    }
    for (const voice of changed) {
      pending.delete(voice);
      if (!voice.closest('.chat-msg-area')) continue;
      const bars = voice.querySelectorAll('.ptt-element__progress-item').length;
      const bubble = voice.closest('.ptt-message__container');
      if (!bubble) continue;
      // Keep the native bars dense. Extra space in a short voice goes before its duration.
      const width = Math.max(64, bars * 4 - 2) + 'px';
      if (bubble.style.getPropertyValue('--ll-voice-wave-width') !== width)
        bubble.style.setProperty('--ll-voice-wave-width', width);
      voices.add(bubble);
    }
    for (const bubble of voices) if (!bubble.isConnected) voices.delete(bubble);
  }
  function flush() {
    frame = 0;
    const roots = [...pending];
    pending.clear();
    refresh(roots);
  }
  function scheduleFull() {
    if (frame) cancelAnimationFrame(frame);
    frame = document.hidden ? 0 : requestAnimationFrame(() => refresh());
  }
  const observer = new MutationObserver(records => {
    if (document.hidden) return;
    for (const record of records) {
      const voice = record.target.closest?.(selector);
      if (voice) pending.add(voice);
      else for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(selector)) pending.add(node);
        for (const nested of node.querySelectorAll(selector)) pending.add(nested);
      }
    }
    if (pending.size && !frame) frame = requestAnimationFrame(flush);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', scheduleFull);
  window.__liuliVoiceLayout = { refresh, dispose() {
    observer.disconnect();
    cancelAnimationFrame(frame);
    pending.clear();
    document.removeEventListener('visibilitychange', scheduleFull);
    for (const bubble of voices) bubble.style.removeProperty('--ll-voice-wave-width');
    voices.clear();
    delete window.__liuliVoiceLayout;
  } };
  refresh();
})();
