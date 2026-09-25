/**
 * Pasted money values often arrive with currency symbols, thousands
 * separators or spaces ("$1,234.56"). Keep only the characters that can be
 * part of a number so the paste lands as an editable numeric draft.
 */
export function sanitizeNumberInput(raw: string): string {
  return raw.replace(/[^0-9.-]/g, '');
}
