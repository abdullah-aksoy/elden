/** Yeni yayınlanan ilan id’si; yanlış ilanda banner çıkmasın diye eşleştirilir. */
let pendingPublishedListingId: string | null = null;

export function markListingJustPublished(listingId: string): void {
  pendingPublishedListingId = listingId;
}

/** Bu ilan az önce yayınlandıysa true döner ve bekleyen id’yi temizler. */
export function consumeListingJustPublished(listingId: string): boolean {
  if (pendingPublishedListingId === null) return false;
  if (pendingPublishedListingId === listingId) {
    pendingPublishedListingId = null;
    return true;
  }
  pendingPublishedListingId = null;
  return false;
}
