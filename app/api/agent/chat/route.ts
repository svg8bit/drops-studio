import { generateText, type LanguageModel } from "ai";
import { NextRequest } from "next/server.js";
import { z } from "zod";

import { findArtifactSecrets } from "../../../../lib/artifact-security.ts";
import { resolveBuilderModel } from "../../../../lib/builder-agent/providers.ts";
import type {
  BuilderModelResolver,
  BuilderProviderCredentials,
  BuilderProviderSelection,
} from "../../../../lib/builder-agent/types.ts";
import { ProjectRuntimeProviderError } from "../../../../lib/project-runtime-adapter.ts";
import {
  builderActor,
  builderJson,
  builderRouteError,
  consumeBuilderLimit,
  readBuilderBody,
  rememberedBuilderConnection,
  requireBuilderSameOrigin,
} from "../../builder/shared.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

const providerSchema = z.object({
  provider: z.enum(["gateway", "openai", "anthropic", "openrouter", "kimi", "custom"]),
  model: z.string().trim().min(1).max(192).optional(),
  baseUrl: z.string().url().max(2_000).optional(),
}).strict();

const requestSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/i),
  message: z.string().trim().min(1).max(4_000),
  provider: providerSchema,
  context: z.object({
    name: z.string().trim().min(1).max(120),
    presetId: z.string().trim().min(1).max(80),
    description: z.string().max(500),
    filePaths: z.array(z.string().min(1).max(240)).max(100),
    recentMessages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(2_000),
    }).strict()).max(12),
  }).strict(),
}).strict();

interface GenerateChatInput {
  model: LanguageModel;
  system: string;
  prompt: string;
  abortSignal: AbortSignal;
}

export interface AgentChatRouteDependencies {
  modelResolver?: BuilderModelResolver;
  rememberConnection?: (
    request: NextRequest,
    selection: BuilderProviderSelection,
  ) => Promise<{
    credentials: BuilderProviderCredentials;
    selection: BuilderProviderSelection;
  }>;
  generate?: (input: GenerateChatInput) => Promise<{ text: string }>;
}

function safeProviderFailure(error: unknown): ProjectRuntimeProviderError {
  if (error instanceof ProjectRuntimeProviderError) return error;
  return new ProjectRuntimeProviderError(
    "The selected AI model did not complete this chat request. The project was not changed.",
  );
}

export async function handleAgentChatRequest(
  request: NextRequest,
  dependencies: AgentChatRouteDependencies = {},
) {
  try {
    requireBuilderSameOrigin(request);
    const actorId = builderActor(request);
    await Promise.all([
      consumeBuilderLimit(actorId, "agent-chat-daily", {
        max: 120,
        windowMs: 24 * 60 * 60_000,
        retryAfter: 86_400,
      }),
      consumeBuilderLimit(actorId, "agent-chat-minute", {
        max: 12,
        windowMs: 60_000,
        retryAfter: 60,
      }),
    ]);
    const parsed = requestSchema.safeParse(await readBuilderBody(request));
    if (!parsed.success) {
      return builderJson(
        {
          code: "AGENT_CHAT_INVALID_REQUEST",
          error: "A valid bounded Studio chat request is required.",
        },
        400,
      );
    }
    if (findArtifactSecrets(JSON.stringify(parsed.data), "agent chat request").length) {
      return builderJson(
        {
          code: "AGENT_CHAT_SECRET_REJECTED",
          error: "Remove credential values from the chat message and use Connections instead.",
        },
        400,
      );
    }
    const remembered = await (
      dependencies.rememberConnection ?? rememberedBuilderConnection
    )(request, parsed.data.provider);
    const resolved = await (dependencies.modelResolver ?? resolveBuilderModel)(
      remembered.selection,
      remembered.credentials,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let result: { text: string };
    try {
      result = await (dependencies.generate ?? (async (input) => generateText({
        model: input.model,
        system: input.system,
        prompt: input.prompt,
        abortSignal: input.abortSignal,
        maxOutputTokens: 1_200,
        maxRetries: 1,
      })))(
        {
          model: resolved.model,
          system:
            "You are Drops Agent inside one existing crypto product project. Answer in the language of the latest user message. Use only the supplied project context. Be concise and practical. Never claim a file edit, build, deployment, Telegram delivery, connection, or external action unless the context explicitly proves it. Never request or repeat API keys, tokens, private keys, or credentials. If the user asks for a change, explain that a change request will run through the verified file-edit flow; this endpoint is conversation-only.",
          prompt: JSON.stringify({
            project: parsed.data.context,
            latestUserMessage: parsed.data.message,
          }),
          abortSignal: controller.signal,
        },
      );
    } catch (error) {
      throw safeProviderFailure(error);
    } finally {
      clearTimeout(timer);
    }
    const reply = result.text.trim();
    if (!reply || findArtifactSecrets(reply, "agent chat response").length) {
      throw new ProjectRuntimeProviderError(
        "The selected AI model returned an unsafe or empty response. The project was not changed.",
      );
    }
    return builderJson({
      reply,
      provider: resolved.evidence.provider,
      model: resolved.evidence.model,
    });
  } catch (error) {
    return builderRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  return handleAgentChatRequest(request);
}
