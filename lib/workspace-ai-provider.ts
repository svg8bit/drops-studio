import { createGateway, generateText, Output } from "ai";
import {
  parseWorkspaceAiPatch,
  workspaceAiPatchJsonSchema,
  workspaceAiPatchSchema,
  WorkspaceAiPatchValidationError,
  type WorkspaceAiPatch,
  type WorkspaceAiPatchRequest,
} from "./workspace-ai-patch.ts";

export const PLATFORM_WORKSPACE_MODELS = [
  "openai/gpt-5.6-sol",
  "inclusionai/ling-3.0-flash-free",
] as const;

export const DEFAULT_WORKSPACE_BYOK_MODELS = {
  openrouter: "openrouter/free",
  openai: "gpt-5.6-sol",
  anthropic: "claude-sonnet-5",
  kimi: "kimi-k3",
} as const;

const MAX_OUTPUT_TOKENS = 24_000;
const PROVIDER_TIMEOUT_MS = 45_000;
const MAX_CREDENTIAL_LENGTH = 4_096;
const UNSUPPORTED_STRICT_SCHEMA_KEYWORDS = new Set([
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
]);

function providerCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerCompatibleSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_STRICT_SCHEMA_KEYWORDS.has(key))
      .map(([key, entry]) => [key, providerCompatibleSchema(entry)]),
  );
}

export const workspaceAiProviderJsonSchema = providerCompatibleSchema(
  workspaceAiPatchJsonSchema,
) as typeof workspaceAiPatchJsonSchema;

const SYSTEM_PROMPT = `You are the AI workspace engineer inside Drops Studio. Return one bounded multi-file patch that turns the existing source workspace into the distinct crypto product requested by the user.

The response must match the supplied JSON Schema exactly. Use only create, update and delete file operations. Keep baseRevision exactly equal to the supplied workspace revision. Make the smallest coherent multi-file change that produces an editable, runnable product rather than a renamed card mockup.

Security boundaries are immutable: never include credentials, API keys, bearer tokens, shell commands, lockfiles, dot-env files, package lifecycle scripts, eval, dynamic Function construction, child processes, executable expressions or host filesystem access. You may add registry dependencies with explicit semver versions, but you must not change package.json scripts. Do not claim provider automation or execution unless the existing workspace already contains verified provider evidence. Return no markdown or prose outside the schema.`;

type WorkspaceProvider = WorkspaceAiPatchRequest["provider"];
type DirectProvider = Exclude<WorkspaceProvider, "platform">;

export type WorkspaceAiSchemaEnforcement =
  | "ai-sdk-output-object"
  | "provider-json-schema"
  | "forced-tool-schema"
  | "application-validated-json";

export interface WorkspaceAiProviderEvidence {
  status: "provider-response";
  provider:
    | "vercel-ai-gateway"
    | "openrouter"
    | "openai"
    | "anthropic"
    | "kimi";
  model: string;
  requestedModel: string | null;
  providerRequestId: string | null;
  credentialOwner: "platform" | "visitor";
  keyPersisted: false;
  billing: "platform-funded" | "provider-direct-no-studio-markup";
  schemaEnforcement: WorkspaceAiSchemaEnforcement;
  generatedAt: string;
}

export interface GeneratedWorkspaceAiPatch {
  patch: WorkspaceAiPatch;
  evidence: WorkspaceAiProviderEvidence;
}

export interface WorkspaceAiProviderCredentials {
  identity?: string;
  openRouterKey?: string;
  providerKey?: string;
}

interface PlatformGenerateInput {
  model: (typeof PLATFORM_WORKSPACE_MODELS)[number];
  schema: typeof workspaceAiPatchJsonSchema;
  system: string;
  prompt: string;
  identity: string;
  gatewayToken: string;
}

interface PlatformGenerateResult {
  output: unknown;
  providerRequestId?: string | null;
}

export interface WorkspaceAiProviderDependencies {
  env?: Partial<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  platformGenerate?: (
    input: PlatformGenerateInput,
  ) => Promise<PlatformGenerateResult>;
}

export class WorkspaceAiProviderUnavailableError extends Error {
  constructor(message = "The selected AI workspace provider is not configured.") {
    super(message);
    this.name = "WorkspaceAiProviderUnavailableError";
  }
}

export class WorkspaceAiProviderResponseError extends Error {
  constructor(message = "The AI provider did not return a valid workspace patch.") {
    super(message);
    this.name = "WorkspaceAiProviderResponseError";
  }
}

function generationPrompt(request: WorkspaceAiPatchRequest): string {
  return JSON.stringify({
    request: request.prompt,
    baseRevision: request.baseRevision,
    workspace: {
      schemaVersion: request.workspace.schemaVersion,
      revision: request.workspace.revision,
      files: request.workspace.files,
    },
    outputSchema: workspaceAiProviderJsonSchema,
  });
}

function providerRequestId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 240
    ? value
    : null;
}

function evidence(
  request: WorkspaceAiPatchRequest,
  input: {
    provider: WorkspaceAiProviderEvidence["provider"];
    model: string;
    requestId?: unknown;
    credentialOwner: WorkspaceAiProviderEvidence["credentialOwner"];
    billing: WorkspaceAiProviderEvidence["billing"];
    schemaEnforcement: WorkspaceAiSchemaEnforcement;
  },
  now: () => Date,
): WorkspaceAiProviderEvidence {
  return {
    status: "provider-response",
    provider: input.provider,
    model: input.model,
    requestedModel: request.model ?? null,
    providerRequestId: providerRequestId(input.requestId),
    credentialOwner: input.credentialOwner,
    keyPersisted: false,
    billing: input.billing,
    schemaEnforcement: input.schemaEnforcement,
    generatedAt: now().toISOString(),
  };
}

function credential(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length < 8 ||
    normalized.length > MAX_CREDENTIAL_LENGTH ||
    /[\r\n]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}

async function defaultPlatformGenerate(
  input: PlatformGenerateInput,
): Promise<PlatformGenerateResult> {
  const gateway = createGateway({ apiKey: input.gatewayToken });
  const result = await generateText({
    model: gateway(input.model),
    output: Output.object({
      schema: workspaceAiPatchSchema,
      name: "drops_workspace_patch",
      description:
        "A bounded atomic patch for an editable Drops Studio source workspace.",
    }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    system: input.system,
    prompt: input.prompt,
    abortSignal: AbortSignal.timeout(18_000),
    providerOptions: {
      gateway: {
        user: input.identity,
        tags: ["feature:workspace-patch", "surface:drops-studio"],
      },
    },
  });
  const metadata = result as unknown as {
    response?: { id?: unknown };
    providerMetadata?: { gateway?: { requestId?: unknown } };
  };
  return {
    output: result.output,
    providerRequestId: providerRequestId(
      metadata.response?.id ?? metadata.providerMetadata?.gateway?.requestId,
    ),
  };
}

async function generatePlatformPatch(
  request: WorkspaceAiPatchRequest,
  credentials: WorkspaceAiProviderCredentials,
  dependencies: WorkspaceAiProviderDependencies,
): Promise<GeneratedWorkspaceAiPatch> {
  const env = dependencies.env ?? process.env;
  const gatewayToken = credential(
    env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN,
  );
  if (!gatewayToken) {
    throw new WorkspaceAiProviderUnavailableError(
      "Platform AI workspace generation is not configured.",
    );
  }
  const identity = credentials.identity?.trim() || "anonymous-workspace";
  const generate = dependencies.platformGenerate ?? defaultPlatformGenerate;
  const prompt = generationPrompt(request);

  for (const model of PLATFORM_WORKSPACE_MODELS) {
    try {
      const result = await generate({
        model,
        schema: workspaceAiPatchJsonSchema,
        system: SYSTEM_PROMPT,
        prompt,
        identity,
        gatewayToken,
      });
      const patch = parseWorkspaceAiPatch(result.output);
      return {
        patch,
        evidence: evidence(
          request,
          {
            provider: "vercel-ai-gateway",
            model,
            requestId: result.providerRequestId,
            credentialOwner: "platform",
            billing: "platform-funded",
            schemaEnforcement: "ai-sdk-output-object",
          },
          dependencies.now ?? (() => new Date()),
        ),
      };
    } catch {
      // The fixed fallback order is intentional. No provider error text or token
      // is exposed to the caller, and no local/mock patch is substituted.
    }
  }
  throw new WorkspaceAiProviderResponseError(
    "Platform AI could not return a valid workspace patch.",
  );
}

interface JsonProviderResponse {
  id?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  content?: Array<{
    type?: unknown;
    name?: unknown;
    input?: unknown;
  }>;
}

async function providerJson(
  response: Response,
  provider: DirectProvider,
): Promise<JsonProviderResponse> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new WorkspaceAiProviderResponseError(
      `${provider} could not complete workspace generation.`,
    );
  }
  return payload as JsonProviderResponse;
}

function jsonContent(payload: JsonProviderResponse): unknown {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new WorkspaceAiProviderResponseError();
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new WorkspaceAiProviderResponseError();
  }
}

function structuredResponseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "drops_workspace_patch",
      strict: true,
      schema: workspaceAiProviderJsonSchema,
    },
  } as const;
}

async function generateDirectPatch(
  request: WorkspaceAiPatchRequest,
  credentials: WorkspaceAiProviderCredentials,
  dependencies: WorkspaceAiProviderDependencies,
): Promise<GeneratedWorkspaceAiPatch> {
  const provider = request.provider as DirectProvider;
  const suppliedKey =
    provider === "openrouter"
      ? credential(credentials.openRouterKey)
      : credential(credentials.providerKey);
  if (!suppliedKey) {
    throw new WorkspaceAiProviderUnavailableError(
      `Connect ${provider} with a request-only API key before generating workspace files.`,
    );
  }

  const model = request.model ?? DEFAULT_WORKSPACE_BYOK_MODELS[provider];
  const fetchProvider = dependencies.fetch ?? globalThis.fetch;
  const prompt = generationPrompt(request);
  let endpoint: string;
  let body: Record<string, unknown>;
  let headers: Record<string, string>;
  let schemaEnforcement: WorkspaceAiSchemaEnforcement;

  if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": suppliedKey,
    };
    schemaEnforcement = "forced-tool-schema";
    body = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.15,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "submit_workspace_patch",
          description:
            "Return the validated file operations. This is data-only and is never executed as a tool.",
          input_schema: workspaceAiProviderJsonSchema,
        },
      ],
      tool_choice: { type: "tool", name: "submit_workspace_patch" },
    };
  } else {
    endpoint =
      provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : provider === "kimi"
          ? "https://api.moonshot.ai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
    headers = {
      authorization: `Bearer ${suppliedKey}`,
      "content-type": "application/json",
    };
    schemaEnforcement =
      provider === "kimi"
        ? "application-validated-json"
        : "provider-json-schema";
    body = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      ...(provider === "openai" && /^gpt-5(?:\.|-|$)/i.test(model)
        ? { max_completion_tokens: MAX_OUTPUT_TOKENS }
        : { max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.15 }),
      ...(provider === "kimi"
        ? { response_format: { type: "json_object" } }
        : { response_format: structuredResponseFormat() }),
      ...(provider === "openrouter"
        ? { provider: { require_parameters: true } }
        : {}),
    };
  }

  let payload: JsonProviderResponse;
  try {
    const response = await fetchProvider(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: timeoutSignal(),
    });
    payload = await providerJson(response, provider);
  } catch (error) {
    if (error instanceof WorkspaceAiProviderResponseError) throw error;
    throw new WorkspaceAiProviderResponseError(
      `${provider} could not complete workspace generation.`,
    );
  }

  let rawPatch: unknown;
  if (provider === "anthropic") {
    const toolUse = payload.content?.find(
      (part) =>
        part.type === "tool_use" && part.name === "submit_workspace_patch",
    );
    rawPatch = toolUse?.input;
  } else {
    rawPatch = jsonContent(payload);
  }

  let patch: WorkspaceAiPatch;
  try {
    patch = parseWorkspaceAiPatch(rawPatch);
  } catch (error) {
    if (error instanceof WorkspaceAiPatchValidationError) {
      throw new WorkspaceAiProviderResponseError();
    }
    throw error;
  }

  return {
    patch,
    evidence: evidence(
      request,
      {
        provider,
        model,
        requestId: payload.id,
        credentialOwner: "visitor",
        billing: "provider-direct-no-studio-markup",
        schemaEnforcement,
      },
      dependencies.now ?? (() => new Date()),
    ),
  };
}

export async function generateWorkspaceAiPatch(
  request: WorkspaceAiPatchRequest,
  credentials: WorkspaceAiProviderCredentials = {},
  dependencies: WorkspaceAiProviderDependencies = {},
): Promise<GeneratedWorkspaceAiPatch> {
  return request.provider === "platform"
    ? generatePlatformPatch(request, credentials, dependencies)
    : generateDirectPatch(request, credentials, dependencies);
}
