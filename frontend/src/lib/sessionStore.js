// Keep saving and history on the same repository; never migrate data implicitly.
export function selectSessionStore(access, localStore, cloudStore) {
  // Expiry or a failed access check must never redirect account data to this device.
  return access.user ? cloudStore : localStore;
}
