// Compatibility for an already-running index.js closure. A normal window load
// uses the updated layout module directly and does not need this bridge.
(() => {
  window.__liuliLayoutCompatibility?.dispose();
  const pendingMenus = new Set();
  const pendingPanels = new Set();
  const patched = new WeakSet();
  let frame = 0;
  function collect(node) {
    if (node.nodeType !== 1 || node.closest('.chat-msg-area,.recent-contact,.group-box')) return;
    const menu = node.closest('.aio-right-click-menu');
    if (menu) pendingMenus.add(menu);
    for (const child of node.querySelectorAll('.aio-right-click-menu')) pendingMenus.add(child);
    if (node.matches('.liuli-lo')) pendingPanels.add(node);
    for (const child of node.querySelectorAll('.liuli-lo')) pendingPanels.add(child);
  }
  function flush() {
    frame = 0;
    for (const menu of pendingMenus) if (menu.isConnected) window.LiuliLayout.applyMenu(menu);
    pendingMenus.clear();
    for (const panel of pendingPanels) {
      if (!panel.isConnected || patched.has(panel)) continue;
      patched.add(panel);
      if (panel.querySelector('[draggable="true"]')) continue;
      panel.replaceChildren();
      window.LiuliLayout.buildLayoutControls(panel);
    }
    pendingPanels.clear();
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const parentMenu = record.target.closest?.('.aio-right-click-menu');
      if (parentMenu) pendingMenus.add(parentMenu);
      for (const node of record.addedNodes) collect(node);
    }
    if ((pendingMenus.size || pendingPanels.size) && !frame) frame = requestAnimationFrame(flush);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  collect(document.body);
  flush();
  window.__liuliLayoutCompatibility = { dispose() {
    observer.disconnect();
    cancelAnimationFrame(frame);
    pendingMenus.clear();
    pendingPanels.clear();
    delete window.__liuliLayoutCompatibility;
  } };
})();
