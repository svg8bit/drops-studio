# Agent Intelligence v2 master-prompt integration record

The supplied `CODEX-MASTER-PROMPT.md` is an implementation and acceptance instruction, not a runtime prompt. It is therefore not loaded into end-user model context.

Its executable requirements map to:

- canonical runtime contract: `docs/agent/DROPS_STUDIO_AGENT_SYSTEM_V2.md`;
- composite model contract: `docs/agent/COMPOSITE_MODEL_SYSTEM.md`;
- Context Compiler contract: `docs/agent/CONTEXT_COMPILER_RAG.md`;
- multi-agent contract: `docs/agent/MULTI_AGENT_ORCHESTRATION.md`;
- eval contract: `docs/agent/EVALS_FEEDBACK_PLATFORM.md`;
- implementation map: `docs/agent/IMPLEMENTATION_BLUEPRINT.md`;
- code under `lib/agent`, internal APIs/UI, unit suites, and the opt-in seeded live Sandbox test.

The runtime loader reads only the marked core of the canonical agent contract, then composes bounded versioned modules. It does not send this master prompt, repository engineering instructions, all documentation, full logs, or private source to a model.
