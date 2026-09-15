/**
 * Lab is the default workspace. Only an explicit `false` opts out.
 */
export function isPrismLabEnabled(value: string | null | undefined) {
  return value?.trim().toLowerCase() !== "false";
}
