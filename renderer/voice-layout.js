(() => {
  window.__liuliVoiceLayout?.dispose();
  let frame = 0;
  const voices = new Set();
  // Retire the old coupling between maximum width and voice's natural size.
  document.body.style.removeProperty('--ll-voice-width-ratio');

  function refresh() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (document.hidden) return;
    for (const voice of document.querySelectorAll('.chat-msg-area .ptt-element')) {
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
  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(refresh);
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target === document.body ||
      (record.type === 'childList' && (record.target.closest?.('.chat-msg-area') ||
        [...record.addedNodes].some(node => node.nodeType === 1 &&
          (node.matches('.chat-msg-area') || node.querySelector('.chat-msg-area'))))))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('storage', schedule);
  window.__liuliVoiceLayout = { refresh, dispose() {
    observer.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('storage', schedule);
    for (const bubble of voices) bubble.style.removeProperty('--ll-voice-wave-width');
    voices.clear();
    delete window.__liuliVoiceLayout;
  } };
  refresh();
})();
