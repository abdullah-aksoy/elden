import type { Href } from 'expo-router';

/** Typed routes henüz tüm dinamik yolları kapsamadığında güvenli yönlendirme. */
export function editListingHref(id: string): Href {
  return `/edit-listing/${id}` as Href;
}
