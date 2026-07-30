import { parseBrowserFlowSpec } from "./schema.ts";
import type { BrowserFlowSpec, BrowserFlowStep } from "./types.ts";

export interface BenchmarkBrowserDriver {
  navigate(path: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: Extract<BrowserFlowStep, { action: "press" }>["key"]): Promise<void>;
  expectVisible(selector: string): Promise<void>;
  expectText(selector: string, text: string): Promise<void>;
  expectUrl(path: string): Promise<void>;
  expectNoConsoleErrors(): Promise<void>;
  expectNoFailedRequests(): Promise<void>;
  expectNoHorizontalOverflow(): Promise<void>;
  runAxe(): Promise<void>;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Benchmark browser flow aborted.");
}

async function executeStep(driver: BenchmarkBrowserDriver, step: BrowserFlowStep): Promise<void> {
  switch (step.action) {
    case "navigate": return driver.navigate(step.path);
    case "click": return driver.click(step.selector);
    case "fill": return driver.fill(step.selector, step.value);
    case "press": return driver.press(step.selector, step.key);
    case "expect-visible": return driver.expectVisible(step.selector);
    case "expect-text": return driver.expectText(step.selector, step.text);
    case "expect-url": return driver.expectUrl(step.path);
    case "expect-no-console-errors": return driver.expectNoConsoleErrors();
    case "expect-no-failed-requests": return driver.expectNoFailedRequests();
    case "expect-no-horizontal-overflow": return driver.expectNoHorizontalOverflow();
    case "axe-scan": return driver.runAxe();
  }
}

export async function runBenchmarkBrowserFlow(input: {
  spec: BrowserFlowSpec;
  driver: BenchmarkBrowserDriver;
  signal?: AbortSignal;
}): Promise<{ flowId: string; evidenceIds: string[] }> {
  const spec = parseBrowserFlowSpec(input.spec);
  const controller = new AbortController();
  const cancel = () => controller.abort(input.signal?.reason ?? new Error("Benchmark browser flow aborted."));
  if (input.signal?.aborted) cancel();
  else input.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(`Browser flow ${spec.id} timed out.`)), spec.timeoutMs);
  const evidenceIds: string[] = [];
  try {
    await input.driver.navigate(spec.startPath);
    evidenceIds.push(`browser:${spec.id}:start`);
    for (let index = 0; index < spec.steps.length; index += 1) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      await Promise.race([
        executeStep(input.driver, spec.steps[index]),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(abortError(controller.signal)), { once: true })),
      ]);
      evidenceIds.push(`browser:${spec.id}:step:${index + 1}`);
    }
    return { flowId: spec.id, evidenceIds };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", cancel);
  }
}
