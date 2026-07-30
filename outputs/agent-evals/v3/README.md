# Drops Agent V3 evidence artifacts

These artifacts are generated from repository-owned code and fixtures. Do not edit them by hand.

Generate:

```bash
node scripts/generate-agent-v3-evidence.mjs
```

Verify that committed artifacts are current:

```bash
node scripts/generate-agent-v3-evidence.mjs --check
```

Evidence boundaries:

- `compact-core-metrics.json` measures the V3 prompt sources and hashes their content.
- `benchmark-catalog.json` and `benchmark-manifest.json` validate 120 case definitions. They are not model, Sandbox, or browser run results.
- `repairs.jsonl` contains 36 validated synthetic source-level fixtures across 12 failure classes. It contains no build or browser evidence.
- `failure-features.jsonl` and `failure-clustering-report.json` are deterministically derived from those repair records.
- Candidate regression benchmarks are emitted only when cluster thresholds pass. They remain candidates and do not mutate the canonical registry.
- No provider credentials or provider execution evidence are consumed or claimed by this generator.
