import { z } from "zod";

import type {
  GenerationDiagnostic,
  GenerationEvent,
  GenerationEventInput,
  GenerationEventStream,
} from "./types.ts";

const pathSchema = z.string().min(1).max(240);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const diagnosticSchema: z.ZodType<GenerationDiagnostic> = z.object({
  id: z.string().min(1).max(128),
  code: z.enum([
    "EVENT_INVALID",
    "STREAM_INCOMPLETE",
    "STREAM_LIMIT_EXCEEDED",
    "FILE_LIMIT_EXCEEDED",
    "PATH_INVALID",
    "PATH_FORBIDDEN",
    "FILE_PROTOCOL_INVALID",
    "STALE_FILE_HASH",
    "DUPLICATE_FILE_CONFLICT",
    "SECRET_DETECTED",
    "SYNTAX_INVALID",
    "JSON_INVALID",
    "PACKAGE_MANIFEST_INVALID",
    "INSTALL_SCRIPT_FORBIDDEN",
    "IMPORT_UNRESOLVED",
    "IMPORT_EXTENSION_AMBIGUOUS",
    "ALIAS_UNRESOLVED",
    "PACKAGE_EXPORT_INVALID",
    "DEPENDENCY_MISSING",
    "LUCIDE_ICON_UNAVAILABLE",
    "NEXT_CLIENT_BOUNDARY",
    "ASSET_PATH_INVALID",
    "API_ROUTE_MISSING",
    "MALFORMED_PATCH",
    "FIXER_SHADOW_ONLY",
  ]),
  severity: z.enum(["info", "warning", "error", "blocking"]),
  message: z.string().min(1).max(1_000),
  path: pathSchema.optional(),
  line: z.number().int().positive().optional(),
  evidence: z.string().max(2_000).optional(),
  fixerId: z.string().min(1).max(128).optional(),
}).strict();

const eventSchema: z.ZodType<GenerationEvent> = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("text.delta"), value: z.string().max(32_000) }).strict(),
  z.object({ version: z.literal(1), type: z.literal("file.begin"), path: pathSchema, expectedHash: hashSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("file.delta"), path: pathSchema, value: z.string().max(64_000) }).strict(),
  z.object({ version: z.literal(1), type: z.literal("file.end"), path: pathSchema }).strict(),
  z.object({ version: z.literal(1), type: z.literal("tool.call"), tool: z.string().min(1).max(128), input: z.unknown() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("diagnostic"), diagnostic: diagnosticSchema }).strict(),
  z.object({ version: z.literal(1), type: z.literal("complete") }).strict(),
]);

export class GenerationEventDecodeError extends Error {
  constructor(message = "Generation event stream is invalid.") {
    super(message);
    this.name = "GenerationEventDecodeError";
  }
}

export function parseGenerationEvent(value: unknown): GenerationEvent {
  const result = eventSchema.safeParse(value);
  if (!result.success) {
    throw new GenerationEventDecodeError("Generation event does not match protocol version 1.");
  }
  return result.data;
}

async function* asAsyncIterable(
  stream: GenerationEventStream,
): AsyncGenerator<GenerationEventInput> {
  if (Symbol.asyncIterator in Object(stream)) {
    for await (const value of stream as AsyncIterable<GenerationEventInput>) yield value;
    return;
  }
  for (const value of stream as Iterable<GenerationEventInput>) yield value;
}

/**
 * String fallback is deliberately JSONL-only. Arbitrary Markdown/code-fence
 * recovery is not deterministic enough to reach canonical project writes.
 */
export async function* decodeGenerationEvents(
  stream: GenerationEventStream,
): AsyncGenerator<GenerationEvent> {
  let buffer = "";
  for await (const input of asAsyncIterable(stream)) {
    if (typeof input !== "string") {
      if (buffer.trim()) {
        throw new GenerationEventDecodeError(
          "A partial JSONL event cannot be interleaved with structured events.",
        );
      }
      yield parseGenerationEvent(input);
      continue;
    }
    buffer += input;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        yield parseGenerationEvent(JSON.parse(line));
      } catch (error) {
        if (error instanceof GenerationEventDecodeError) throw error;
        throw new GenerationEventDecodeError("Generation JSONL contains malformed JSON.");
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield parseGenerationEvent(JSON.parse(tail));
    } catch (error) {
      if (error instanceof GenerationEventDecodeError) throw error;
      throw new GenerationEventDecodeError("Generation JSONL ended with malformed JSON.");
    }
  }
}
