import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway } from "ai";
import type {
  BuilderModelResolution,
  BuilderModelResolver,
  BuilderProviderSelection,
} from "./types.ts";

const DEFAULT_MODELS = {
  gateway: "openai/gpt-5.6-sol",
  openai: "gpt-5.6-sol",
  anthropic: "claude-sonnet-5",
  openrouter: "openrouter/free",
  kimi: "kimi-k3",
} as const;
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_CUSTOM_PROVIDER_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const NON_PUBLIC_IPV4 = new BlockList();
const NON_PUBLIC_IPV6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_IPV4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NON_PUBLIC_IPV6.addSubnet(network, prefix, "ipv6");
}

export interface ResolvedCustomProviderEndpoint {
  baseURL: string;
  hostname: string;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

export class BuilderModelUnavailableError extends Error {
  constructor(message = "The selected builder AI provider is unavailable.") {
    super(message);
    this.name = "BuilderModelUnavailableError";
  }
}

function credential(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length < 8 ||
    normalized.length > MAX_CREDENTIAL_LENGTH ||
    /[\r\n\0]/.test(normalized)
  ) {
    throw new BuilderModelUnavailableError(
      "A valid request-only provider credential is required.",
    );
  }
  return normalized;
}

function modelId(value: string | undefined, fallback: string): string {
  const model = value?.trim() || fallback;
  if (!/^[a-z0-9][a-z0-9._:/-]{0,191}$/i.test(model)) {
    throw new BuilderModelUnavailableError("Builder model id is invalid.");
  }
  return model;
}

function privateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return NON_PUBLIC_IPV4.check(address, "ipv4");
  if (family === 6) return NON_PUBLIC_IPV6.check(address, "ipv6");
  return true;
}

export async function resolveCustomProviderEndpoint(
  value: string | undefined,
  lookupImpl: typeof lookup = lookup,
): Promise<ResolvedCustomProviderEndpoint> {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new BuilderModelUnavailableError("Custom provider URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    isIP(url.hostname) > 0
  ) {
    throw new BuilderModelUnavailableError(
      "Custom provider URL must be a public HTTPS hostname.",
    );
  }
  let addresses: Array<{ address: string; family: 4 | 6 }>;
  try {
    addresses = (await lookupImpl(url.hostname, { all: true, verbatim: true }))
      .filter((entry) => entry.family === 4 || entry.family === 6)
      .map((entry) => ({
        address: entry.address,
        family: entry.family as 4 | 6,
      }));
  } catch {
    throw new BuilderModelUnavailableError("Custom provider hostname is unavailable.");
  }
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
    throw new BuilderModelUnavailableError(
      "Custom provider hostname cannot resolve to a private network.",
    );
  }
  return {
    baseURL: url.toString().replace(/\/$/, ""),
    hostname: url.hostname,
    addresses,
  };
}

function providerPathAllowed(baseURL: string, target: URL): boolean {
  const base = new URL(baseURL);
  const basePath = base.pathname.replace(/\/$/, "");
  return (
    target.protocol === "https:" &&
    target.origin === base.origin &&
    (target.pathname === basePath || target.pathname.startsWith(`${basePath}/`))
  );
}

/**
 * Node's global fetch performs a second DNS lookup after validation, which is
 * vulnerable to DNS rebinding. Custom-provider calls therefore use HTTPS with
 * a lookup callback pinned to the already validated public addresses while TLS
 * continues to verify the original hostname through SNI.
 */
export function createPinnedCustomProviderFetch(
  endpoint: ResolvedCustomProviderEndpoint,
): typeof fetch {
  return async (input, init) => {
    const outbound = input instanceof Request
      ? new Request(input, init)
      : new Request(input, init);
    const target = new URL(outbound.url);
    if (!providerPathAllowed(endpoint.baseURL, target)) {
      throw new BuilderModelUnavailableError(
        "Custom provider attempted a request outside its validated HTTPS endpoint.",
      );
    }
    const body = ["GET", "HEAD"].includes(outbound.method)
      ? null
      : Buffer.from(await outbound.arrayBuffer());
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, response?: Response) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else if (response) resolve(response);
      };
      const request = httpsRequest(target, {
        method: outbound.method,
        headers: Object.fromEntries(outbound.headers.entries()),
        signal: outbound.signal,
        servername: endpoint.hostname,
        lookup: (_hostname, options, callback) => {
          const requestedFamily = typeof options === "number"
            ? options
            : options?.family;
          const address = endpoint.addresses.find((entry) =>
            requestedFamily === 4 || requestedFamily === 6
              ? entry.family === requestedFamily
              : true,
          );
          if (!address) {
            callback(new Error("No validated custom-provider address matches the requested family."), "");
            return;
          }
          callback(null, address.address, address.family);
        },
      }, (incoming) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > MAX_CUSTOM_PROVIDER_RESPONSE_BYTES) {
            incoming.destroy(new Error("Custom provider response exceeded the bounded size."));
            return;
          }
          chunks.push(buffer);
        });
        incoming.on("error", (error) => finish(error));
        incoming.on("end", () => {
          const status = incoming.statusCode ?? 502;
          if (status < 200 || status > 599) {
            finish(new Error("Custom provider returned an invalid HTTP status."));
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined || name.toLowerCase() === "set-cookie") continue;
            headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
          }
          finish(undefined, new Response(Buffer.concat(chunks), { status, headers }));
        });
      });
      request.on("error", (error) => finish(error));
      request.end(body ?? undefined);
    });
  };
}

function result(
  selection: BuilderProviderSelection,
  model: BuilderModelResolution["model"],
  resolvedModel: string,
  credentialOwner: "platform" | "visitor",
): BuilderModelResolution {
  if (selection.provider === "free") {
    throw new BuilderModelUnavailableError(
      "Free mode uses deterministic fallback and does not resolve an AI model.",
    );
  }
  return {
    model,
    evidence: {
      provider: selection.provider,
      model: resolvedModel,
      credentialOwner,
      keyPersisted: false,
    },
  };
}

export const resolveBuilderModel: BuilderModelResolver = async (
  selection,
  credentials,
) => {
  switch (selection.provider) {
    case "free":
      throw new BuilderModelUnavailableError(
        "Free mode uses deterministic fallback generation.",
      );
    case "gateway": {
      const key = credential(
        credentials.gatewayToken ||
          process.env.AI_GATEWAY_API_KEY ||
          process.env.VERCEL_OIDC_TOKEN,
      );
      const selectedModel = modelId(selection.model, DEFAULT_MODELS.gateway);
      return result(selection, createGateway({ apiKey: key })(selectedModel), selectedModel, "platform");
    }
    case "openai": {
      const key = credential(credentials.apiKey);
      const selectedModel = modelId(selection.model, DEFAULT_MODELS.openai);
      return result(selection, createOpenAI({ apiKey: key })(selectedModel), selectedModel, "visitor");
    }
    case "anthropic": {
      const key = credential(credentials.apiKey);
      const selectedModel = modelId(selection.model, DEFAULT_MODELS.anthropic);
      return result(selection, createAnthropic({ apiKey: key })(selectedModel), selectedModel, "visitor");
    }
    case "openrouter": {
      const key = credential(credentials.openRouterKey || credentials.apiKey);
      const selectedModel = modelId(selection.model, DEFAULT_MODELS.openrouter);
      const provider = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
        headers: {
          "HTTP-Referer": "https://drops.studio",
          "X-OpenRouter-Title": "Drops Studio",
        },
      });
      return result(selection, provider(selectedModel), selectedModel, "visitor");
    }
    case "kimi": {
      const key = credential(credentials.apiKey);
      const selectedModel = modelId(selection.model, DEFAULT_MODELS.kimi);
      const provider = createOpenAICompatible({
        name: "kimi",
        baseURL: "https://api.moonshot.ai/v1",
        apiKey: key,
      });
      return result(selection, provider(selectedModel), selectedModel, "visitor");
    }
    case "custom": {
      const key = credential(credentials.apiKey);
      const selectedModel = modelId(selection.model, "custom-model");
      const endpoint = await resolveCustomProviderEndpoint(selection.baseUrl);
      const provider = createOpenAICompatible({
        name: "custom",
        baseURL: endpoint.baseURL,
        apiKey: key,
        fetch: createPinnedCustomProviderFetch(endpoint),
      });
      return result(selection, provider(selectedModel), selectedModel, "visitor");
    }
  }
};
