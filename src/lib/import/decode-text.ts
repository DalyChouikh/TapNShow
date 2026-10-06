/**
 * File bytes as text: UTF-8 when valid (a leading BOM is dropped by TextDecoder), otherwise
 * Windows-1252 — what Excel's "CSV" export uses on French and other Western Windows setups.
 */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
