/**
 * Which section the reader is on, given each section's top edge relative to
 * the viewport (in document order) and the reading line just below the
 * pinned bar. A section is "on" once its top has reached the line; at the
 * bottom of the page it is the last one, since a short final section can
 * never scroll up far enough to reach the line. -1 when there are none.
 */
export function sectionAt(tops: number[], line: number, atBottom: boolean): number {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let found = 0;
  tops.forEach((top, index) => {
    if (top <= line) found = index;
  });
  return found;
}
