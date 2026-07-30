export interface StudioConnectionHandoff {
  connections: boolean;
  provider: string | null;
  flow: string | null;
  project: string | null;
}

function cleanParameter(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 160) : null;
}

export function parseStudioConnectionHandoff(
  search: string,
): StudioConnectionHandoff {
  const params = new URLSearchParams(search);
  return {
    connections: params.get("connections") === "1",
    provider: cleanParameter(params.get("provider")),
    flow: cleanParameter(params.get("flow")),
    project: cleanParameter(params.get("project")),
  };
}
