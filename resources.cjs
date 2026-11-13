const fs = require('node:fs/promises');
const path = require('node:path');

const SCRIPTS = [
  'renderer/host.js',
  'renderer/qq.js',
  'renderer/message-overscan.js',
  'renderer/scroll-time.js',
  'renderer/voice-layout.js',
  'assets/mcu.js',
  'renderer/color-roles.js',
  'renderer/layout-custom.js',
  'renderer/ark-external.js',
  'renderer/diag.js',
  'renderer/motion.js',
  'renderer/switch-motion-guard.js',
  'renderer/side-pane-motion.js',
  // 置顶会话分组（#55）：必须排在 index.js 之前，index 启动时就会调
  // window.__liuliPinGroups.apply。
  'renderer/pin-groups.js',
  'renderer/video-wallpaper.js',
  'renderer/background-performance.js',
  'renderer/index.js'
];
const roots = new Map();

async function refresh(root, state) {
  const assets = (await fs.readdir(path.join(root, 'assets'))).filter(
    name => name.endsWith('.css') || name === 'wallpaper.jpg'
  );
  const names = [...assets.map(name => 'assets/' + name), ...SCRIPTS];
  const entries = await Promise.all(
    names.map(async name => {
      const file = path.join(root, name);
      const stat = await fs.stat(file, { bigint: true });
      const version = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      const cached = state.files.get(name);
      return [
        name,
        cached?.version === version ? cached : { version, bytes: await fs.readFile(file) }
      ];
    })
  );
  if (
    state.snapshot &&
    entries.length === state.files.size &&
    entries.every(([name, entry]) => state.files.get(name) === entry)
  )
    return state.snapshot;

  const files = new Map(entries);
  const inventory = Object.create(null);
  for (const name of assets) {
    const bytes = files.get('assets/' + name).bytes;
    inventory[name] = {
      name,
      fetchOk: true,
      status: 200,
      bytes: bytes.length,
      text: name.endsWith('.css') ? bytes.toString('utf8') : ''
    };
  }
  const wallpaper = files.get('assets/wallpaper.jpg')?.bytes;
  state.snapshot = {
    assets: inventory,
    wallpaper: wallpaper ? 'data:image/jpeg;base64,' + wallpaper.toString('base64') : '',
    source: SCRIPTS.map(name => files.get(name).bytes.toString('utf8')).join('\n')
  };
  state.files = files;
  return state.snapshot;
}

module.exports = function loadResources(root) {
  root = path.resolve(root);
  if (!roots.has(root)) roots.set(root, { files: new Map(), pending: null, snapshot: null });
  const state = roots.get(root);
  // Concurrent window loads share one read; each later load still checks for edits.
  state.pending ??= refresh(root, state).finally(() => {
    state.pending = null;
  });
  return state.pending;
};
