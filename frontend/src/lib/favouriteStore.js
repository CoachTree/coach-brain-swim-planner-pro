export function selectFavouriteStore(access, localStore, cloudStore) {
  return access.user ? cloudStore : localStore;
}
