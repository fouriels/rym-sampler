/** Case-, accent- and punctuation-insensitive form of a name, for matching:
 * "Hip-Hop" and "hip hop" fold to the same thing, "Björk" to "bjork". Applied
 * to both sides of a comparison, so scripts whose marks are stripped still match. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
