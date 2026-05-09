let pendingProfileSaved = false;

export function markProfileJustSaved(): void {
  pendingProfileSaved = true;
}

export function consumeProfileJustSaved(): boolean {
  const v = pendingProfileSaved;
  pendingProfileSaved = false;
  return v;
}
