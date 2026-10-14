/**
 * Copies text to the clipboard. Returns false instead of throwing when the browser refuses
 * (permission denied, insecure page, no clipboard), so callers can tell the person.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
