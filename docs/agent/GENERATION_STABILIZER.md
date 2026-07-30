# Drops Generation Stabilizer

**Version:** 3.0.0
**Status:** implemented reusable control-plane layer; every fixer defaults to shadow mode

## Purpose

The Stabilizer sits between model streaming/tool output and an atomic Project V2
revision. It is not another coding agent and does not interpret product intent.
It decodes a strict event protocol, buffers files outside the canonical project,
performs bounded deterministic checks, records safe fixer proposals, and only
then calls the existing Project V2 atomic mutation engine.

No partial stream can mutate a project. Tool-call events are evidence only; the
Stabilizer never executes them. Secrets are rejected before a patch bundle or
canonical file can be created.

## Event protocol

All events use `version: 1` and one of:

- `text.delta`
- `file.begin`
- `file.delta`
- `file.end`
- `tool.call`
- `diagnostic`
- `complete`

Native typed events are preferred. The only fallback is bounded JSONL, which
can be fragmented across transport chunks. Markdown and code-fence recovery is
intentionally unsupported because it cannot provide deterministic file/tool
boundaries.

The decoder rejects unknown fields, oversized deltas, invalid event order,
events after `complete`, malformed JSONL, and mixed partial JSONL/typed events.
Event receipts contain ordinal, type, optional normalized path, and byte count;
they never contain generated source or tool inputs.

## Atomic pipeline

```text
typed event stream
-> strict decoder
-> bounded file buffers
-> POSIX/path/hash policy
-> duplicate reconciliation
-> per-fixer proposal registry
-> TypeScript/JavaScript/JSON checks
-> import/dependency/framework checks
-> secret scan
-> patch bundle
-> existing atomic Project V2 mutation + validator
```

The stream must end with exactly one `complete` event and no open file. Identical
duplicate writes coalesce. Conflicting duplicates, stale `expectedHash` values,
malformed source, unsafe paths, unresolved imports, missing dependencies,
forbidden package install scripts, and framework boundary errors reject the
whole bundle.

## Deterministic checks

The current layer checks:

- canonical relative POSIX paths and Project V2 file/byte limits;
- traversal, absolute, null-byte, protected directory, `.env`, and lockfile targets;
- stale expected hashes and duplicate operation conflicts;
- TypeScript/JavaScript syntactic diagnostics through the installed TypeScript parser;
- strict JSON and package manifest shape;
- forbidden `preinstall`, `install`, and `postinstall` lifecycle scripts;
- relative project imports and unambiguous JSON/CSS extension candidates;
- aliases against current `tsconfig` paths;
- bounded relative package export-map entries;
- imported packages against runtime/development dependencies;
- curated unavailable Lucide names;
- Next.js client-only API boundaries;
- invalid `/public/*` asset references;
- literal `/api/*` references against generated route files;
- environment-variable **names only**, never values;
- credential patterns before every canonical write.

Unknown package versions, ambiguous import targets, missing routes, undocumented
provider behavior, server/client semantic rewrites, and arbitrary AST repairs
produce diagnostics. They are never guessed or mutated.

## Fixer registry and shadow mode

Every fixer is independently configured as `disabled`, `shadow`, or `active`.
The default is `shadow`. A proposal always records:

```ts
{
  fixerId,
  version,
  inputHash,
  outputHash,
  reasonCode,
  affectedPaths,
  confidence: "deterministic",
  mode,
  applied
}
```

Initial fixers are deliberately narrow:

| Fixer | Safe boundary | Default |
|---|---|---|
| `lucide-curated-icon-map` | Known hallucinated identifier to curated available identifier in one file | shadow |
| `next-public-asset-path` | Removes `/public` only when the corresponding generated `public/*` file exists | shadow |
| `relative-data-extension` | Adds only the single existing `.json` or `.css` candidate | shadow |
| `package-duplicate-dependency` | Removes a dev dependency only when the same name and exact version already exists in runtime dependencies | shadow |

An active fixer changes only its proposed file content before the complete
deterministic check pass. A shadow fixer records hashes and reason without
changing content. If unresolved source remains invalid, the result is
`shadow-blocked`; otherwise the unchanged valid source may commit with the
shadow proposal retained for evaluation.

Promotion follows:

```text
verified trace
-> repeated-pattern cluster
-> candidate fixer
-> shadow mode
-> benchmark validation
-> canary
-> active
```

Changing one fixer mode is a rollback boundary; Router and AutoFix defaults do
not need to change.

## Synthetic verified repair corpus

`lib/agent/repairs/dataset-v3.ts` exposes a deterministic, JSONL-serializable
corpus of 36 source-level examples across 12 failure classes. Each record has:

- version and deterministic IDs;
- sanitized failure summary;
- synthetic context provenance;
- before/after SHA-256 hashes;
- one bounded patch write with its expected base hash;
- executed fixture/focused/secret check evidence IDs;
- source and `CC0-1.0` licensing metadata;
- dedupe hash;
- explicit human-review state (`false`);
- explicit build and browser applicability.

These initial fixtures are isolated source-level cases, not runnable apps.
Therefore build and browser checks are truthfully marked not applicable, with
reasons and no evidence IDs. The validator rejects any record that marks either
check required without evidence. This corpus does **not** claim 36 production
builds or browser sessions. Future Sandbox/browser traces may be appended only
with their real evidence IDs and provenance.

The validator also rejects missing license/consent, absent provenance, secret
material, stale hashes, failed focused markers, invalid after-source, missing
check evidence, and duplicate repairs. `user-opt-in` records require a consent
ID and never inherit the synthetic license automatically.

## Production integration boundary

The public API integration point is the provider stream/tool bridge immediately
before existing `write_file`/`apply_patch` mutations. Call
`stabilizeGeneration({ project, stream, policy })`, inspect diagnostics and
provenance, and use the returned `project` only when `committed === true`.

This module intentionally does not change current Router, AutoFix, API route,
or fixer defaults. Production rollout should start with the existing shadow
defaults and privacy-safe trace aggregation, then enable a fixer individually
only after its benchmark/canary evidence is reviewed.
