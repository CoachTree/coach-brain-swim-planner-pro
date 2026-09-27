// Keep saving and history on the same repository; never migrate data implicitly.
export function selectSessionStore(access, localStore, cloudStore) {
  return access.isPro && access.user ? cloudStore : localStore;
}
