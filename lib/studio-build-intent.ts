export const STUDIO_AUTO_BUILD_PARAM = "autobuild";
export const STUDIO_BUILD_REQUEST_PARAM = "buildRequest";

export interface StudioLocationSnapshot {
  pathname: string;
  search: string;
  hash?: string;
}

/**
 * Normalizes the creation-only build marker without consuming it. The marker
 * remains recoverable across reloads and the Connections round-trip until the
 * builder returns a terminal receipt.
 */
export function consumeStudioBuildIntent(
  location: StudioLocationSnapshot,
  replaceUrl: (url: string) => void,
  createRequestId: () => string,
): string | null {
  const params = new URLSearchParams(location.search);
  if (params.get(STUDIO_AUTO_BUILD_PARAM) !== "1") return null;

  const requestId = params.get(STUDIO_BUILD_REQUEST_PARAM)?.trim()
    || createRequestId();
  params.set(STUDIO_AUTO_BUILD_PARAM, "1");
  params.set(STUDIO_BUILD_REQUEST_PARAM, requestId);

  const query = params.toString();
  const normalized = `${location.pathname}${query ? `?${query}` : ""}${location.hash ?? ""}`;
  const current = `${location.pathname}${location.search}${location.hash ?? ""}`;
  if (normalized !== current) replaceUrl(normalized);
  return requestId;
}

/** Clears only the matching terminal build intent, preserving newer requests. */
export function clearStudioBuildIntent(
  location: StudioLocationSnapshot,
  requestId: string,
  replaceUrl: (url: string) => void,
): boolean {
  const params = new URLSearchParams(location.search);
  if (
    params.get(STUDIO_AUTO_BUILD_PARAM) !== "1"
    || params.get(STUDIO_BUILD_REQUEST_PARAM)?.trim() !== requestId
  ) {
    return false;
  }
  params.delete(STUDIO_AUTO_BUILD_PARAM);
  params.delete(STUDIO_BUILD_REQUEST_PARAM);
  const query = params.toString();
  replaceUrl(
    `${location.pathname}${query ? `?${query}` : ""}${location.hash ?? ""}`,
  );
  return true;
}
