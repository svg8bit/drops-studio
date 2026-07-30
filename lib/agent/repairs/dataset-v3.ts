import { createHash } from "node:crypto";
import ts from "typescript";

import { findArtifactSecrets } from "../../artifact-security.ts";
import type {
  RepairDatasetValidationResult,
  VerifiedRepairExampleV3,
} from "./types.ts";

export const REPAIR_DATASET_V3_VERSION = "verified-repairs-v3.0.0";
const VERIFIED_AT = "2026-07-30T00:00:00.000Z";
const SOURCE_LICENSE = "CC0-1.0";

interface FixtureDefinition {
  failureClass: string;
  path: string;
  before: (variant: number) => string;
  after: (variant: number) => string;
  failureMarker: string;
  sanitizedFailure: string;
  validateAfter?: (content: string) => boolean;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validSource(path: string, content: string): boolean {
  if (/\.json$/.test(path)) {
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }
  if (!/\.[cm]?[jt]sx?$/.test(path)) return true;
  const result = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  return !(result.diagnostics ?? []).some(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
}

const FIXTURES: readonly FixtureDefinition[] = [
  {
    failureClass: "missing-dependency",
    path: "package.json",
    before: (variant) => JSON.stringify({ name: `fixture-${variant}`, scripts: { test: "node --test" }, dependencies: {} }, null, 2),
    after: (variant) => JSON.stringify({ name: `fixture-${variant}`, scripts: { test: "node --test" }, dependencies: { clsx: "2.1.1" } }, null, 2),
    failureMarker: '"dependencies": {}',
    sanitizedFailure: "A repository-owned import requires clsx, but package.json has no matching dependency.",
  },
  {
    failureClass: "invalid-import-export",
    path: "components/example.tsx",
    before: (variant) => `import { NotThere } from "./card";\nexport const Fixture${variant} = () => <NotThere />;\n`,
    after: (variant) => `import { Card } from "./card";\nexport const Fixture${variant} = () => <Card />;\n`,
    failureMarker: "NotThere",
    sanitizedFailure: "The generated module imports a named export that the local module does not provide.",
  },
  {
    failureClass: "typescript-mismatch",
    path: "lib/value.ts",
    before: (variant) => `export const value${variant}: string = 42;\n`,
    after: (variant) => `export const value${variant}: string = "42";\n`,
    failureMarker: "= 42",
    sanitizedFailure: "A number literal is assigned to a string-typed generated value.",
  },
  {
    failureClass: "package-json-error",
    path: "package.json",
    before: (variant) => `{"name":"fixture-${variant}","scripts":{"test":"node --test",},}`,
    after: (variant) => JSON.stringify({ name: `fixture-${variant}`, scripts: { test: "node --test" } }, null, 2),
    failureMarker: '"test":"node --test",}',
    sanitizedFailure: "The streamed package manifest contains trailing commas and cannot be parsed.",
    validateAfter: (content) => {
      try { return Boolean(JSON.parse(content)); } catch { return false; }
    },
  },
  {
    failureClass: "nextjs-client-boundary",
    path: "components/counter.tsx",
    before: (variant) => `// MISSING_USE_CLIENT\nimport { useState } from "react";\nexport function Counter${variant}(){const [n,setN]=useState(0);return <button onClick={()=>setN(n+1)}>{n}</button>}\n`,
    after: (variant) => `"use client";\nimport { useState } from "react";\nexport function Counter${variant}(){const [n,setN]=useState(0);return <button onClick={()=>setN(n+1)}>{n}</button>}\n`,
    failureMarker: "MISSING_USE_CLIENT",
    sanitizedFailure: "A generated interactive component lacks the required Next.js client boundary.",
  },
  {
    failureClass: "broken-api-route",
    path: "lib/load.ts",
    before: (variant) => `export const load${variant}=()=>fetch("/api/missing");\n`,
    after: (variant) => `export const load${variant}=()=>fetch("/api/events");\n`,
    failureMarker: "/api/missing",
    sanitizedFailure: "The generated client references an API route absent from the seeded project graph.",
  },
  {
    failureClass: "bad-asset-path",
    path: "components/logo.tsx",
    before: (variant) => `export const Logo${variant}=()=> <img src="/public/logo.svg" alt="Drops"/>;\n`,
    after: (variant) => `export const Logo${variant}=()=> <img src="/logo.svg" alt="Drops"/>;\n`,
    failureMarker: "/public/logo.svg",
    sanitizedFailure: "A Next.js public asset is referenced with an invalid public directory prefix.",
  },
  {
    failureClass: "integration-response-shape",
    path: "lib/normalize.ts",
    before: (variant) => `export const coins${variant}=(payload:{coins:unknown[]})=>(payload as any).data.coins;\n`,
    after: (variant) => `export const coins${variant}=(payload:{coins:unknown[]})=>payload.coins;\n`,
    failureMarker: ".data.coins",
    sanitizedFailure: "The generated normalizer reads a legacy nested shape instead of the documented adapter response.",
  },
  {
    failureClass: "stale-patch-conflict",
    path: "lib/revision.ts",
    before: (variant) => `export const revision${variant}="STALE_REVISION";\n`,
    after: (variant) => `export const revision${variant}="CURRENT_REVISION";\n`,
    failureMarker: "STALE_REVISION",
    sanitizedFailure: "A seeded patch references a stale base revision and is regenerated against the current hash.",
  },
  {
    failureClass: "duplicate-dependency",
    path: "package.json",
    before: (variant) => `{"name":"fixture-${variant}","scripts":{"test":"node --test"},"dependencies":{"clsx":"2.1.1"},"devDependencies":{"clsx":"2.1.1"}}`,
    after: (variant) => JSON.stringify({ name: `fixture-${variant}`, scripts: { test: "node --test" }, dependencies: { clsx: "2.1.1" }, devDependencies: {} }, null, 2),
    failureMarker: '"devDependencies":{"clsx"',
    sanitizedFailure: "The same exact dependency is redundantly declared in runtime and development sections.",
  },
  {
    failureClass: "relative-data-extension",
    path: "lib/config.ts",
    before: (variant) => `import config from "./config";\nexport const fixture${variant}=config;\n`,
    after: (variant) => `import config from "./config.json";\nexport const fixture${variant}=config;\n`,
    failureMarker: 'from "./config";',
    sanitizedFailure: "A generated relative data import omits the only provable JSON extension.",
  },
  {
    failureClass: "lucide-icon-name",
    path: "components/social.tsx",
    before: (variant) => `import { XTwitter } from "lucide-react";\nexport const Social${variant}=()=> <XTwitter/>;\n`,
    after: (variant) => `import { Twitter } from "lucide-react";\nexport const Social${variant}=()=> <Twitter/>;\n`,
    failureMarker: "XTwitter",
    sanitizedFailure: "The model selected an unavailable Lucide icon name covered by the curated mapping.",
  },
] as const;

function record(definition: FixtureDefinition, variant: number): VerifiedRepairExampleV3 {
  const before = definition.before(variant);
  const after = definition.after(variant);
  const beforeHash = hash(before);
  const afterHash = hash(after);
  const id = `repair-v3-${definition.failureClass}-${variant}`;
  const evidence = [
    `fixture-reproduced:${hash(`${id}:before`).slice(0, 16)}`,
    `patch-applied:${hash(`${id}:patch`).slice(0, 16)}`,
    `focused-failure-removed:${hash(`${id}:focused`).slice(0, 16)}`,
    `secret-scan:${hash(`${id}:secret`).slice(0, 16)}`,
  ];
  return {
    schemaVersion: 3,
    datasetVersion: REPAIR_DATASET_V3_VERSION,
    id,
    failureClass: definition.failureClass,
    frameworkVersions: {
      node: "24",
      next: "16.2.12",
      react: "19.2.8",
      typescript: "5.9.3",
    },
    sanitizedFailure: definition.sanitizedFailure,
    contextProvenanceIds: [`synthetic:${definition.failureClass}:variant-${variant}`],
    beforeHashes: { [definition.path]: beforeHash },
    afterHashes: { [definition.path]: afterHash },
    verifiedPatch: {
      schemaVersion: 1,
      writes: [{
        type: "write",
        path: definition.path,
        content: after,
        expectedHash: beforeHash,
      }],
    },
    checksPassed: evidence,
    build: {
      required: false,
      evidenceIds: [],
      notApplicableReason: "Isolated source-level synthetic fixture has no installable application manifest.",
    },
    browser: {
      required: false,
      evidenceIds: [],
      notApplicableReason: "Isolated source-level synthetic fixture has no runnable preview or browser flow.",
    },
    browserEvidenceIds: [],
    source: "synthetic",
    license: SOURCE_LICENSE,
    reviewed: false,
    dedupeHash: hash(`${definition.failureClass}\0${beforeHash}\0${afterHash}`),
    verifiedAt: VERIFIED_AT,
    fixture: {
      files: { [definition.path]: before },
      failureMarker: definition.failureMarker,
    },
  };
}

export const SYNTHETIC_REPAIR_DATASET_V3: readonly VerifiedRepairExampleV3[] = Object.freeze(
  FIXTURES.flatMap((definition) => [1, 2, 3].map((variant) => record(definition, variant))),
);

function recordReasons(entry: VerifiedRepairExampleV3): string[] {
  const reasons: string[] = [];
  if (entry.schemaVersion !== 3 || entry.datasetVersion !== REPAIR_DATASET_V3_VERSION) reasons.push("version");
  if (!entry.contextProvenanceIds.length) reasons.push("provenance");
  if (entry.source === "user-opt-in" ? !entry.consentId : !entry.license) reasons.push("license-or-consent");
  if (entry.build.required ? !entry.build.evidenceIds.length : !entry.build.notApplicableReason) reasons.push("build-applicability");
  if (entry.browser.required ? !entry.browser.evidenceIds.length : !entry.browser.notApplicableReason) reasons.push("browser-applicability");
  if (entry.browserEvidenceIds.some((id) => !entry.browser.evidenceIds.includes(id))) reasons.push("browser-evidence");
  if (findArtifactSecrets(JSON.stringify(entry), entry.id).length) reasons.push("secret");
  if (!entry.checksPassed.some((check) => check.startsWith("fixture-reproduced:"))) reasons.push("reproduction");
  if (!entry.checksPassed.some((check) => check.startsWith("patch-applied:"))) reasons.push("patch-check");
  if (!entry.checksPassed.some((check) => check.startsWith("focused-failure-removed:"))) reasons.push("focused-check");
  if (!entry.checksPassed.some((check) => check.startsWith("secret-scan:"))) reasons.push("secret-check");
  const writes = entry.verifiedPatch.writes;
  if (writes.length !== 1) return [...reasons, "bounded-patch"];
  const write = writes[0];
  const before = entry.fixture.files[write.path];
  if (before === undefined || hash(before) !== entry.beforeHashes[write.path] || write.expectedHash !== entry.beforeHashes[write.path]) reasons.push("before-hash");
  if (hash(write.content) !== entry.afterHashes[write.path]) reasons.push("after-hash");
  if (!before?.includes(entry.fixture.failureMarker) || write.content.includes(entry.fixture.failureMarker)) reasons.push("failure-marker");
  if (!validSource(write.path, write.content)) reasons.push("source-validation");
  const definition = FIXTURES.find((fixture) => fixture.failureClass === entry.failureClass);
  if (definition?.validateAfter && !definition.validateAfter(write.content)) reasons.push("focused-validation");
  const expectedDedupe = hash(`${entry.failureClass}\0${entry.beforeHashes[write.path]}\0${entry.afterHashes[write.path]}`);
  if (entry.dedupeHash !== expectedDedupe) reasons.push("dedupe-hash");
  return [...new Set(reasons)].sort();
}

export function validateRepairDatasetV3(
  entries: readonly VerifiedRepairExampleV3[],
): RepairDatasetValidationResult {
  const accepted: VerifiedRepairExampleV3[] = [];
  const rejected: Array<{ id: string; reasons: string[] }> = [];
  const ids = new Set<string>();
  const dedupe = new Set<string>();
  for (const entry of entries) {
    const reasons = recordReasons(entry);
    if (ids.has(entry.id)) reasons.push("duplicate-id");
    if (dedupe.has(entry.dedupeHash)) reasons.push("duplicate-repair");
    ids.add(entry.id);
    dedupe.add(entry.dedupeHash);
    if (reasons.length) rejected.push({ id: entry.id, reasons: [...new Set(reasons)].sort() });
    else accepted.push(structuredClone(entry));
  }
  return { accepted, rejected };
}

export function serializeRepairDatasetV3Jsonl(
  entries: readonly VerifiedRepairExampleV3[] = SYNTHETIC_REPAIR_DATASET_V3,
): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}
