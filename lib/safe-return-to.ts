const MAX_RETURN_PATH_LENGTH = 2_048;

export function safeSameOriginReturnPath(
  value: string | null | undefined,
  origin: string,
  fallback = "/",
): string {
  const raw = value ?? "";
  const candidate = raw.trim();
  if (
    !candidate
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
    || candidate.length > MAX_RETURN_PATH_LENGTH
    || /[\r\n\0\\]/.test(raw)
  ) {
    return fallback;
  }

  try {
    const base = new URL(origin);
    const resolved = new URL(candidate, base);
    if (
      !["http:", "https:"].includes(base.protocol)
      || base.username
      || base.password
      || resolved.origin !== base.origin
      || resolved.username
      || resolved.password
    ) {
      return fallback;
    }
    const localPath = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    return localPath.startsWith("/") && !localPath.startsWith("//")
      ? localPath
      : fallback;
  } catch {
    return fallback;
  }
}
