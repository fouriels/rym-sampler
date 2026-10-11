// One family -> one colour, everywhere (the treemap, the atlas) -- assigned
// by descending primary-genre count so "Regional Music" is always the same
// hue. 26 CSS custom properties (--family-0..25) defined in theme.css; this
// module just does the family-name -> slot-index lookup once and shares it.
export function buildFamilyColorMap(familiesByCountDesc: string[]): Map<string, string> {
  const map = new Map<string, string>();
  familiesByCountDesc.forEach((name, i) => map.set(name, `var(--family-${i})`));
  return map;
}
