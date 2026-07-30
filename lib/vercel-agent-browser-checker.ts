import {
  runAgentBrowserCommand,
  withAgentBrowserSandbox,
  type AgentBrowserCommandResult,
  type VercelSandboxSession,
  type WithAgentBrowserSandboxOptions,
} from "@agent-browser/sandbox/vercel";
import { findArtifactSecrets } from "./artifact-security.ts";
import {
  ProjectRuntimeProviderError,
  ProjectRuntimeUnavailableError,
  ProjectRuntimeValidationError,
  boundedRuntimeOutput,
} from "./project-runtime-adapter.ts";
import type {
  BuilderBrowserChecker,
  BuilderBrowserCheckResult,
} from "./builder-agent/types.ts";

const SNAPSHOT_ID = /^[A-Za-z0-9_-]{8,192}$/;
const BROWSER_CHECK_TIMEOUT_MS = 55_000;
const MAX_RESULT_ITEMS = 20;
const MAX_WALK_NODES = 2_000;

type BrowserCommandRunner = <TJson = unknown>(
  sandbox: VercelSandboxSession,
  args: readonly string[],
  options?: { json?: boolean; session?: string; stepLabel?: string },
) => Promise<AgentBrowserCommandResult<TJson>>;

type BrowserSandboxRunner = <T>(
  callback: (sandbox: VercelSandboxSession) => Promise<T>,
  options?: WithAgentBrowserSandboxOptions,
) => Promise<T>;

export interface VercelAgentBrowserCheckerOptions {
  fetchImpl?: typeof fetch;
  runCommand?: BrowserCommandRunner;
  snapshotId?: string | null;
  withSandbox?: BrowserSandboxRunner;
}

interface RenderProbe {
  readyState: string;
  bodyTextLength: number;
  elementCount: number;
  interactiveCount: number;
  title: string;
}

interface InteractionProbe {
  found: boolean;
  activated: boolean;
  kind: string;
  label: string;
}

function previewUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProjectRuntimeValidationError("Browser preview URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".vercel.run") ||
    url.hostname === ".vercel.run" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new ProjectRuntimeValidationError(
      "Browser checks only accept an HTTPS Vercel Sandbox preview domain.",
    );
  }
  return url;
}

function configuredSnapshotId(override: string | null | undefined): string {
  const value =
    override === undefined
      ? process.env.AGENT_BROWSER_SNAPSHOT_ID?.trim()
      : override?.trim();
  if (!value || !SNAPSHOT_ID.test(value)) {
    throw new ProjectRuntimeUnavailableError(
      "A prebuilt AGENT_BROWSER_SNAPSHOT_ID is required for real browser checks.",
    );
  }
  return value;
}

function safeText(value: unknown, label: string, limit = 800): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!text.trim()) return "";
  if (findArtifactSecrets(text, label).length) {
    return `[${label} redacted: potential secret material]`;
  }
  return boundedRuntimeOutput(text, label, limit).value.trim();
}

function browserFailureDetail(error: unknown, label: string): string {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const candidates = [record?.stderr, record?.stdout, record?.message, error];
  for (const candidate of candidates) {
    for (const value of nestedValues(candidate)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const detail = (value as Record<string, unknown>).error;
      if (typeof detail !== "string" || !detail.trim()) continue;
      const safe = safeText(detail, `${label} diagnostic`, 600)
        .replace(/\s+/g, " ")
        .trim();
      if (safe) return safe;
    }
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const safe = safeText(candidate, `${label} diagnostic`, 600)
      .replace(/\s+/g, " ")
      .trim();
    if (safe) return safe;
  }
  return "";
}

function browserProviderError(label: string, error: unknown): ProjectRuntimeProviderError {
  if (error instanceof ProjectRuntimeProviderError) return error;
  const detail = browserFailureDetail(error, label);
  return new ProjectRuntimeProviderError(
    detail ? `${label} failed: ${detail}` : `${label} failed.`,
  );
}

function nestedValues(root: unknown): unknown[] {
  const values: unknown[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new Set<object>();
  while (queue.length && values.length < MAX_WALK_NODES) {
    const current = queue.shift()!;
    let value = current.value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        current.depth < 5 &&
        ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]")))
      ) {
        try {
          value = JSON.parse(trimmed) as unknown;
        } catch {
          // The string is ordinary browser output, not nested JSON.
        }
      }
    }
    values.push(value);
    if (current.depth >= 8 || !value || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children.slice(0, 200)) {
      queue.push({ value: child, depth: current.depth + 1 });
    }
  }
  return values;
}

function objectWithKeys<T extends Record<string, unknown>>(
  root: unknown,
  keys: readonly string[],
): T | null {
  for (const value of nestedValues(root)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      keys.every((key) => key in value)
    ) {
      return value as T;
    }
  }
  return null;
}

function resultPayload(result: AgentBrowserCommandResult): unknown {
  return result.json ?? result.stdout;
}

function renderProbe(result: AgentBrowserCommandResult): RenderProbe {
  const value = objectWithKeys<Record<string, unknown>>(resultPayload(result), [
    "readyState",
    "bodyTextLength",
    "elementCount",
    "interactiveCount",
  ]);
  if (!value) {
    throw new Error("Browser render probe returned an invalid result.");
  }
  return {
    readyState: String(value.readyState ?? ""),
    bodyTextLength: Number(value.bodyTextLength ?? 0),
    elementCount: Number(value.elementCount ?? 0),
    interactiveCount: Number(value.interactiveCount ?? 0),
    title: safeText(value.title, "browser title", 200),
  };
}

function interactionProbe(result: AgentBrowserCommandResult): InteractionProbe {
  const value = objectWithKeys<Record<string, unknown>>(resultPayload(result), [
    "found",
    "activated",
    "kind",
    "label",
  ]);
  if (!value) {
    throw new Error("Browser interaction probe returned an invalid result.");
  }
  return {
    found: value.found === true,
    activated: value.activated === true,
    kind: safeText(value.kind, "interaction kind", 80),
    label: safeText(value.label, "interaction label", 160),
  };
}

function noEntries(text: string): boolean {
  return (
    !text.trim() ||
    /^(?:done|ok|success)$/i.test(text.trim()) ||
    /(?:no|0) (?:page |console )?(?:errors?|messages?|entries|requests?)/i.test(text)
  );
}

function diagnosticMessages(
  result: AgentBrowserCommandResult,
  mode: "page" | "console",
): string[] {
  const messages: string[] = [];
  for (const value of nestedValues(result.json)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const level = String(record.level ?? record.type ?? record.severity ?? "").toLowerCase();
    if (mode === "console" && level && level !== "error" && level !== "assert") {
      continue;
    }
    const message =
      record.message ?? record.text ?? record.description ?? record.error ?? record.value;
    if (typeof message !== "string" || noEntries(message)) continue;
    const normalized = safeText(message, `${mode} browser error`);
    if (normalized) messages.push(normalized);
  }
  if (result.json == null && !messages.length && !noEntries(result.stdout)) {
    for (const line of result.stdout.split("\n")) {
      if (mode === "console" && !/\b(?:error|assert|uncaught)\b/i.test(line)) continue;
      const normalized = safeText(line, `${mode} browser error`);
      if (normalized) messages.push(normalized);
    }
  }
  return [...new Set(messages)].slice(0, MAX_RESULT_ITEMS);
}

function networkMessages(result: AgentBrowserCommandResult): string[] {
  const messages: string[] = [];
  for (const value of nestedValues(result.json)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const status = Number(
      record.status ?? record.statusCode ?? record.responseStatus ?? Number.NaN,
    );
    if (!Number.isFinite(status) || status < 400) continue;
    const url = safeText(record.url ?? record.requestUrl ?? "request", "network URL", 500);
    messages.push(`${status} ${url || "request"}`);
  }
  if (result.json == null && !messages.length && !noEntries(result.stdout)) {
    for (const line of result.stdout.split("\n")) {
      if (!/\b[45]\d\d\b/.test(line)) continue;
      const normalized = safeText(line, "browser network error");
      if (normalized) messages.push(normalized);
    }
  }
  return [...new Set(messages)].slice(0, MAX_RESULT_ITEMS);
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Browser check timed out.");
  }
}

const RENDER_PROBE = `(() => ({
  readyState: document.readyState,
  bodyTextLength: (document.body?.innerText || "").trim().length,
  elementCount: document.body?.querySelectorAll("*").length || 0,
  interactiveCount: document.body?.querySelectorAll('button, [role="button"], input:not([type="hidden"]), select, textarea, a[href]').length || 0,
  title: document.title || ""
}))()`;

const INTERACTION_PROBE = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(document.querySelectorAll('button:not([disabled]), [role="button"], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
  const target = candidates.find((element) => {
    if (!visible(element)) return false;
    if (element instanceof HTMLAnchorElement) {
      try { return new URL(element.href, location.href).origin === location.origin; } catch { return false; }
    }
    return true;
  });
  if (!target) return { found: false, activated: false, kind: "none", label: "" };
  target.scrollIntoView({ block: "center", inline: "center" });
  target.focus();
  const isFormControl = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if (isFormControl) {
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    target.click();
  }
  const label = (target.getAttribute("aria-label") || target.textContent || target.getAttribute("name") || target.tagName).trim().slice(0, 120);
  return { found: true, activated: document.activeElement === target || !isFormControl, kind: target.tagName.toLowerCase(), label };
})()`;

export class VercelAgentBrowserChecker implements BuilderBrowserChecker {
  readonly #fetch: typeof fetch;
  readonly #runCommand: BrowserCommandRunner;
  readonly #snapshotId: string | null | undefined;
  readonly #withSandbox: BrowserSandboxRunner;

  constructor(options: VercelAgentBrowserCheckerOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#runCommand = options.runCommand ?? runAgentBrowserCommand;
    this.#snapshotId = options.snapshotId;
    this.#withSandbox = options.withSandbox ?? withAgentBrowserSandbox;
  }

  async check(input: Parameters<BuilderBrowserChecker["check"]>[0]): Promise<BuilderBrowserCheckResult> {
    const url = previewUrl(input.url);
    const snapshotId = configuredSnapshotId(this.#snapshotId);
    const timeoutSignal = AbortSignal.timeout(BROWSER_CHECK_TIMEOUT_MS);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeoutSignal])
      : timeoutSignal;
    ensureActive(signal);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal,
        headers: { accept: "text/html,application/xhtml+xml" },
      });
    } catch (error) {
      throw browserProviderError("Verify preview response", error);
    }
    const statusCode = response.status;
    await response.body?.cancel().catch(() => undefined);
    if (response.url) previewUrl(response.url);

    let providerStep = "Boot browser Sandbox";
    try {
      return await this.#withSandbox(
        async (sandbox) => {
          const run = async <TJson = unknown>(args: readonly string[], label: string) => {
            ensureActive(signal);
            try {
              return await this.#runCommand<TJson>(sandbox, args, {
                json: true,
                stepLabel: label,
              });
            } catch (error) {
              throw browserProviderError(label, error);
            }
          };
          await run(["open", "about:blank"], "Verify browser snapshot");
          await run(["set", "viewport", "1440", "900"], "Set browser viewport");
          await run(["errors", "--clear"], "Clear page errors");
          await run(["console", "--clear"], "Clear console");
          await run(["network", "requests", "--clear"], "Clear network log");
          await run(["navigate", url.toString()], "Open Sandbox preview");
          await run(["wait", "1000"], "Wait for preview render");
          const accessibility = await run(["snapshot", "-i", "-c"], "Read accessibility tree");
          const firstRender = renderProbe(await run(["eval", RENDER_PROBE], "Verify rendered page"));
          const interaction = interactionProbe(
            await run(["eval", INTERACTION_PROBE], "Exercise primary interaction"),
          );
          await run(["wait", "400"], "Observe interaction result");
          const secondRender = renderProbe(await run(["eval", RENDER_PROBE], "Verify page after interaction"));
          const pageErrors = diagnosticMessages(
            await run(["errors"], "Read page errors"),
            "page",
          );
          const consoleErrors = diagnosticMessages(
            await run(["console"], "Read console output"),
            "console",
          );
          const networkErrors = networkMessages(
            await run(["network", "requests"], "Read network requests"),
          );
          const rendered =
            (firstRender.readyState === "interactive" || firstRender.readyState === "complete") &&
            firstRender.bodyTextLength > 0 &&
            firstRender.elementCount > 0 &&
            secondRender.bodyTextLength > 0 &&
            Boolean(accessibility.stdout.trim() || accessibility.json);
          const primaryInteractionChecked = interaction.found && interaction.activated;
          const healthyStatus = statusCode >= 200 && statusCode < 400;
          const ok =
            healthyStatus &&
            rendered &&
            primaryInteractionChecked &&
            pageErrors.length === 0 &&
            consoleErrors.length === 0 &&
            networkErrors.length === 0;
          const interactionLabel = interaction.label
            ? `${interaction.kind} “${interaction.label}”`
            : interaction.kind;
          const failureCount =
            pageErrors.length + consoleErrors.length + networkErrors.length;
          const firstFailure = safeText(
            pageErrors[0] ?? consoleErrors[0] ?? networkErrors[0] ?? "",
            "browser failure summary",
            220,
          )
            .replace(/\s+/g, " ")
            .trim();
          return {
            ok,
            rendered,
            primaryInteractionChecked,
            statusCode,
            pageErrors,
            consoleErrors,
            networkErrors,
            summary: ok
              ? `Browser rendered “${secondRender.title || "project preview"}” and exercised ${interactionLabel}.`
              : `Browser check blocked: status ${statusCode}, rendered ${rendered ? "yes" : "no"}, interaction ${primaryInteractionChecked ? "yes" : "no"}, ${failureCount} unexpected browser error${failureCount === 1 ? "" : "s"}.${firstFailure ? ` First: ${firstFailure}` : ""}`,
          };
        },
        {
          snapshotId,
          bootstrap: false,
          stop: true,
          timeout: BROWSER_CHECK_TIMEOUT_MS,
          onStep(event) {
            if (event.status === "running" || event.status === "error") {
              providerStep = safeText(event.step, "browser provider step", 120) || providerStep;
            }
          },
          createOptions: {
            env: {},
            networkPolicy: { allow: [url.hostname] },
            resources: { vcpus: 2 },
            signal,
            tags: {
              application: "drops-studio-browser-check",
            },
          },
        },
      );
    } catch (error) {
      if (error instanceof ProjectRuntimeProviderError) throw error;
      if (signal.aborted) {
        throw new ProjectRuntimeProviderError("Browser check timed out.");
      }
      throw browserProviderError(providerStep, error);
    }
  }
}
