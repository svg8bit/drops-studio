export function studioAccountDisplayName(
  value: string | null | undefined,
  fallback = "Drops Studio member",
): string {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized ? normalized.slice(0, 160) : fallback;
}

export function studioAccountInitial(
  value: string | null | undefined,
  fallback = "D",
): string {
  const displayName = studioAccountDisplayName(value, "");
  return Array.from(displayName)[0]?.toLocaleUpperCase() ?? fallback;
}
