# Context Compiler and RAG — implemented contract

**Source brief:** `CONTEXT_COMPILER_RAG.md` supplied by the product owner  
**Implementation version:** 2.0.0  
**Status:** working and covered by focused tests

This document keeps the supplied architecture visible in the repository while
mapping it to the production implementation. It is intentionally an execution
ledger rather than a second speculative RFC.

## Runtime entry points

- `lib/agent/context/index.ts` — public exports.
- `lib/agent/context/ingest.ts` — bounded source registration, redaction, and
  chunk ingestion.
- `lib/agent/context/compiler.ts` — query compilation and privacy-safe trace.
- `lib/agent/context/retrieve.ts` — lexical/vector candidate retrieval, RRF,
  reranking, MMR, neighbors, and final token budget.
- `lib/agent/context/backends/in-process.ts` — required no-service lexical
  backend and optional vectors.
- `lib/agent/context/backends/blob-snapshot.ts` — private compressed Vercel Blob
  snapshots through an injected storage boundary.
- `lib/agent/runtime/knowledge.ts` — current Project V2 source plus official
  DropsTab/Drops Bot adapter evidence.
- `lib/agent/runtime/intelligent-builder.ts` — Builder API integration.

## Source classes

The compiler distinguishes:

1. system policies;
2. official platform/provider references;
3. current project source;
4. accepted project memory;
5. runtime evidence;
6. untrusted reference material.

Tenant, workspace, project, branch, and revision filters are applied before
lexical or vector scoring. Matching text in another tenant or an older project
revision cannot enter the candidate set.

## Privacy and injection boundary

Redaction runs before source registration, chunking, cache insertion,
embedding, retrieval, prompt composition, and trace persistence. Credential-like
material is rejected or replaced before it can reach a provider. Retrieved
instructions remain labelled data; their text cannot override the core policy,
permissions, approval state, or tool schemas.

Traces contain only source IDs, chunk IDs, scores, omission reasons, query
kinds, token estimates, and version hashes. They do not contain source bodies,
credentials, private prompts, or chain-of-thought.

## Chunking and retrieval

- TypeScript/JavaScript uses symbol-aware code chunks.
- Markdown uses heading-aware chunks.
- OpenAPI uses operation-level chunks and registers only documented methods.
- Lexical retrieval is always available.
- Embeddings and a reranker are optional authorized adapters, never mandatory
  infrastructure.
- Reciprocal-rank fusion and MMR are deterministic for a fixed index/config.
- Neighbor expansion and final token budgeting are bounded.
- Cache keys include tenant/project/revision/model-profile/prompt versions.

## Drops evidence

The knowledge adapter derives its endpoint registry from the current typed
DropsTab and Drops Bot modules. It does not invent undocumented remote writes.
Generated apps receive provider capabilities and attribution rules, never API
keys. Missing provider evidence remains `Setup required` or explicitly labelled
demo data.

## Verified behavior

`tests/agent-context-rag.test.mjs` proves:

- exact project-symbol and documented endpoint retrieval;
- useful lexical-only operation;
- redaction before indexing/embedding/cache;
- prompt-injection isolation;
- tenant/project/revision isolation;
- hybrid fusion, deterministic budgets, and ordering;
- cache invalidation and source deletion;
- official endpoint evidence;
- private Blob snapshot round-trip;
- privacy-safe compilation traces.

The V2 checkpoint completed all 14 focused Context Compiler tests, the full
TypeScript check, scoped ESLint, and the repository unit suite.

## V3 evolution

V3 adds runtime skills, failure clustering, and measured retrieval slices. The
V2 retrieval policy remains the frozen comparison baseline. No Router, AutoFix,
or prompt default is rewritten until the 120-case corpus, model matrix, verified
repairs, Design Agent report, and failure-cluster report satisfy the data gate.
