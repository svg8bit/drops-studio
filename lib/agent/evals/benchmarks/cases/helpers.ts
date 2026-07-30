import type { BrowserFlowSpec } from "../types.ts";

export const REQUIRED_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

export function browserFlow(id: string, options: {
  text?: string;
  click?: string;
  path?: string;
  axe?: boolean;
} = {}): BrowserFlowSpec {
  const steps: BrowserFlowSpec["steps"] = [
    { action: "expect-visible", selector: "main" },
    ...(options.click ? [{ action: "click" as const, selector: options.click }] : []),
    ...(options.text ? [{ action: "expect-text" as const, selector: "main", text: options.text }] : []),
    { action: "expect-no-console-errors" },
    { action: "expect-no-failed-requests" },
    { action: "expect-no-horizontal-overflow" },
    ...(options.axe ? [{ action: "axe-scan" as const }] : []),
  ];
  return {
    id: `${id}-flow`,
    version: "1.0.0",
    startPath: options.path ?? "/",
    steps,
    timeoutMs: 90_000,
  };
}
