/** Lowercase and strip diacritics so "Café" matches "cafe" (also handles Vietnamese đ). */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}
