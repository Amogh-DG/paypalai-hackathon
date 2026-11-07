export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
