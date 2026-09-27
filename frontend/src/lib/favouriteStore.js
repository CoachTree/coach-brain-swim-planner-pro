export function selectFavouriteStore(access, localStore, cloudStore) {
  return access.isPro && access.user ? cloudStore : localStore;
}
