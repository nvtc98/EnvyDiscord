/** Lowercase and strip Vietnamese diacritics so "Cáo Than" matches "cao than". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}
