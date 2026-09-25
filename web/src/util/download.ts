/**
 * Local file download. Everything stays on the user's machine — the app has no
 * network calls at runtime beyond its own assets (spec/06).
 */
export function downloadText(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read an uploaded file locally; it is never sent anywhere. */
export function readFileText(file: File): Promise<string> {
  return file.text();
}
