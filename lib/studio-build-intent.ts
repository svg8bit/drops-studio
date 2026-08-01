export const STUDIO_AUTO_BUILD_PARAM = "autobuild";
export const STUDIO_BUILD_REQUEST_PARAM = "buildRequest";

export interface StudioLocationSnapshot {
  pathname: string;
  search: string;
  hash?: string;
}

/**
 * Turns the creation-only `autobuild=1` URL marker into a one-shot request.
 * The marker is removed before any network work starts, so refreshes, returning
 * from Connections, and ordinary project opens can never enqueue another build.
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
  params.delete(STUDIO_AUTO_BUILD_PARAM);
  params.delete(STUDIO_BUILD_REQUEST_PARAM);

  const query = params.toString();
  replaceUrl(
    `${location.pathname}${query ? `?${query}` : ""}${location.hash ?? ""}`,
  );
  return requestId;
}
