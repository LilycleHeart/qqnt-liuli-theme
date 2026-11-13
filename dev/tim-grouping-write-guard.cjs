'use strict';
// Instance-only bridge for an old groupMessages closure that cannot be replaced.
// Do not intercept unrelated dataset keys, native writes, or DOM prototypes.
function createTimGroupingWriteGuard(isAuthoritative) {
  const rows = new Map();
  const attributes = new Map([
    ['liuliG', 'data-liuli-g'],
    ['liuliAvatarG', 'data-liuli-avatar-g'],
    ['liuliTimText', 'data-liuli-tim-text']
  ]);
  const names = new Set(attributes.values());
  let blocked = 0;
  function legacyWrite() {
    if (isAuthoritative()) return false;
    if (!/\bgroupMessages\b/.test(new Error().stack || '')) return false;
    blocked++;
    return true;
  }
  function capture(row) {
    if (rows.has(row)) return;
    const datasetDescriptor = Object.getOwnPropertyDescriptor(row, 'dataset');
    if (datasetDescriptor && !datasetDescriptor.configurable) return;
    const descriptors = new Map();
    const dataset = row.dataset;
    const getter = () => proxy;
    const proxy = new Proxy(dataset, {
      get(target, key) { return Reflect.get(target, key, target); },
      set(target, key, value) {
        if (attributes.has(key) && legacyWrite()) return true;
        return Reflect.set(target, key, value, target);
      },
      deleteProperty(target, key) {
        if (attributes.has(key) && Object.prototype.hasOwnProperty.call(target, key) && legacyWrite()) return true;
        return Reflect.deleteProperty(target, key);
      }
    });
    descriptors.set('dataset', { descriptor: datasetDescriptor, getter });
    Object.defineProperty(row, 'dataset', { configurable: true, enumerable: true, get: getter });
    for (const method of ['setAttribute', 'removeAttribute', 'toggleAttribute']) {
      const descriptor = Object.getOwnPropertyDescriptor(row, method);
      if (descriptor && !descriptor.configurable) continue;
      const original = row[method];
      const wrapper = function (...args) {
        const name = typeof args[0] === 'string' ? args[0].toLowerCase() : '';
        if (this === row && names.has(name)) {
          const present = row.hasAttribute(name);
          const changes = method === 'setAttribute' ? true :
            method === 'removeAttribute' ? present : present !== (args.length > 1 ? !!args[1] : !present);
          if (changes && legacyWrite()) return method === 'toggleAttribute' ? present : undefined;
        }
        return original.apply(this, args);
      };
      descriptors.set(method, { descriptor, wrapper });
      Object.defineProperty(row, method, { configurable: true, writable: true, value: wrapper });
    }
    rows.set(row, descriptors);
  }
  function restore(row, descriptors) {
    for (const [name, entry] of descriptors) {
      if (name === 'dataset' ? Object.getOwnPropertyDescriptor(row, name)?.get !== entry.getter : row[name] !== entry.wrapper) continue;
      if (entry.descriptor) Object.defineProperty(row, name, entry.descriptor);
      else delete row[name];
    }
    rows.delete(row);
  }
  return {
    capture,
    get blocked() { return blocked; },
    get size() { return rows.size; },
    prune() { for (const [row, descriptors] of rows) if (!row.isConnected) restore(row, descriptors); },
    dispose() { for (const [row, descriptors] of rows) restore(row, descriptors); }
  };
}
module.exports = createTimGroupingWriteGuard;
