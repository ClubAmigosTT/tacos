/**
 * Parse the optional MXN total used by visit forms.
 * `null` means the field was intentionally left blank; `undefined` means the
 * user entered a value that should be corrected before submitting.
 */
export function parseOptionalPrice(raw: string): number | null | undefined {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return undefined;
  return Math.round(value * 100) / 100;
}
