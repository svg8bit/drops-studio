function isDomain(hostname: string, apex: string): boolean {
  return hostname === apex || hostname.endsWith(`.${apex}`);
}

function isStudioTelegramRoute(url: URL): boolean {
  const allowedParams = new Set(["connections", "provider", "flow", "project"]);
  return (
    url.pathname === "/"
    && url.searchParams.get("connections") === "1"
    && url.searchParams.get("provider") === "dropsbot"
    && url.searchParams.get("flow") === "telegram-channel"
    && [...url.searchParams.keys()].every((key) => allowedParams.has(key))
  );
}

export function approvedPreviewExternalUrl(
  value: unknown,
  studioOrigin: string,
): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  let origin: URL;
  let url: URL;
  try {
    origin = new URL(studioOrigin);
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (
    url.origin === origin.origin
    && (url.protocol === "https:" || url.protocol === "http:")
    && isStudioTelegramRoute(url)
  ) {
    return url.toString();
  }
  if (url.protocol !== "https:") return null;
  if (isDomain(url.hostname, "dropstab.com")) return url.toString();
  if (isDomain(url.hostname, "polymarket.com")) return url.toString();
  if (
    url.hostname === "t.me"
    && /^\/Drops\/?$/.test(url.pathname)
    && !url.search
  ) {
    return url.toString();
  }
  return null;
}
