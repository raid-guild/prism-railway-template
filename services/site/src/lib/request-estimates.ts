export function parseEstimatedHumanHours(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") {
    return null;
  }
  const parsed = typeof normalized === "number" ? normalized : typeof normalized === "string" ? Number(normalized) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999) {
    return undefined;
  }
  return Math.round(parsed * 100) / 100;
}
