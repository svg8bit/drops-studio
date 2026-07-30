import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href,
    };
  },
});

const { stabilizeGeneration } = await import("../lib/agent/stabilizer/index.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");

function spec() {
  return createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt: "Build a sourced crypto explorer",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

async function project(id) {
  return materializeProjectV2Template({
    id,
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
}

function fileEvents(path, content, expectedHash) {
  return [
    { version: 1, type: "file.begin", path, ...(expectedHash ? { expectedHash } : {}) },
    { version: 1, type: "file.delta", path, value: content },
    { version: 1, type: "file.end", path },
  ];
}

const complete = { version: 1, type: "complete" };

test("active curated Lucide fixer commits an atomic valid Project V2 with provenance", async () => {
  const base = await project("stabilizer-lucide-active");
  const manifest = JSON.parse(base.files["package.json"].content);
  manifest.dependencies["lucide-react"] = "1.27.0";
  const events = [
    ...fileEvents(
      "package.json",
      JSON.stringify(manifest, null, 2),
      base.files["package.json"].hash,
    ),
    ...fileEvents(
      "components/social-card.tsx",
      'import { XTwitter } from "lucide-react";\nexport const SocialCard=()=> <XTwitter aria-label="X"/>;\n',
    ),
    complete,
  ];
  const captured = [];
  const result = await stabilizeGeneration({
    project: base,
    stream: events,
    policy: { fixerModes: { "lucide-curated-icon-map": "active" } },
    onEvent: (event) => captured.push(event.type),
    now: () => new Date("2026-07-30T12:01:00.000Z"),
  });
  assert.equal(result.status, "committed", JSON.stringify(result.diagnostics));
  assert.equal(result.committed, true);
  assert.equal(result.project.revision, base.revision + 1);
  assert.match(result.project.files["components/social-card.tsx"].content, /Twitter/);
  assert.doesNotMatch(result.project.files["components/social-card.tsx"].content, /XTwitter/);
  assert.deepEqual(captured, [
    "file.begin", "file.delta", "file.end",
    "file.begin", "file.delta", "file.end",
    "complete",
  ]);
  assert.deepEqual(result.transformations.map((entry) => ({ id: entry.fixerId, applied: entry.applied })), [
    { id: "lucide-curated-icon-map", applied: true },
  ]);
  assert.match(result.transformations[0].inputHash, /^[a-f0-9]{64}$/);
  assert.match(result.transformations[0].outputHash, /^[a-f0-9]{64}$/);
  assert.equal(result.transformations[0].confidence, "deterministic");
});

test("default shadow mode records a proposal but does not commit unresolved generated source", async () => {
  const base = await project("stabilizer-lucide-shadow");
  const result = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents(
        "components/social-card.tsx",
        'import { XTwitter } from "lucide-react";\nexport const SocialCard=()=> <XTwitter/>;\n',
      ),
      complete,
    ],
  });
  assert.equal(result.status, "shadow-blocked");
  assert.equal(result.project, null);
  assert.equal(result.committed, false);
  assert.ok(result.transformations.some((entry) => entry.mode === "shadow" && !entry.applied));
  assert.ok(result.diagnostics.some((entry) => entry.code === "LUCIDE_ICON_UNAVAILABLE"));
  assert.equal(base.files["components/social-card.tsx"], undefined);
});

test("partial stream never creates a patch bundle or canonical mutation", async () => {
  const base = await project("stabilizer-partial");
  const result = await stabilizeGeneration({
    project: base,
    stream: [
      { version: 1, type: "file.begin", path: "lib/partial.ts" },
      { version: 1, type: "file.delta", path: "lib/partial.ts", value: "export const partial = true;" },
    ],
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.project, null);
  assert.equal(result.patchBundle, null);
  assert.ok(result.diagnostics.some((entry) => entry.code === "STREAM_INCOMPLETE"));
  assert.equal(base.files["lib/partial.ts"], undefined);
});

test("credential-like streamed source is rejected before canonical write", async () => {
  const base = await project("stabilizer-secret");
  const token = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  const result = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents("lib/secret.ts", `export const value = "${token}";`),
      complete,
    ],
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.project, null);
  assert.ok(result.diagnostics.some((entry) => entry.code === "SECRET_DETECTED"));
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("traversal, absolute, null-byte, lockfile and stale-hash paths never reach writes", async (t) => {
  const base = await project("stabilizer-paths");
  for (const path of ["../escape.ts", "/tmp/escape.ts", "bad\0name.ts", "package-lock.json"]) {
    await t.test(path.replace("\0", "null"), async () => {
      const result = await stabilizeGeneration({
        project: base,
        stream: [...fileEvents(path, "export const unsafe = true;"), complete],
      });
      assert.equal(result.committed, false);
      assert.ok(result.diagnostics.some((entry) => ["PATH_INVALID", "PATH_FORBIDDEN"].includes(entry.code)));
    });
  }
  const stale = await stabilizeGeneration({
    project: base,
    stream: [...fileEvents("app/page.tsx", base.files["app/page.tsx"].content, "0".repeat(64)), complete],
  });
  assert.equal(stale.committed, false);
  assert.ok(stale.diagnostics.some((entry) => entry.code === "STALE_FILE_HASH"));
});

test("identical duplicate writes coalesce while conflicting duplicates reject atomically", async () => {
  const base = await project("stabilizer-duplicates");
  const identical = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents("lib/duplicate.ts", "export const value = 1;\n"),
      ...fileEvents("lib/duplicate.ts", "export const value = 1;\n"),
      complete,
    ],
  });
  assert.equal(identical.status, "committed");
  assert.equal(identical.patchBundle.writes.length, 1);

  const conflict = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents("lib/duplicate.ts", "export const value = 1;\n"),
      ...fileEvents("lib/duplicate.ts", "export const value = 2;\n"),
      complete,
    ],
  });
  assert.equal(conflict.status, "rejected");
  assert.ok(conflict.diagnostics.some((entry) => entry.code === "DUPLICATE_FILE_CONFLICT"));
});

test("JSONL fallback handles fragmented strict events but rejects arbitrary Markdown", async () => {
  const base = await project("stabilizer-jsonl");
  const lines = [
    JSON.stringify({ version: 1, type: "file.begin", path: "lib/jsonl.ts" }),
    JSON.stringify({ version: 1, type: "file.delta", path: "lib/jsonl.ts", value: "export const jsonl = true;\n" }),
    JSON.stringify({ version: 1, type: "file.end", path: "lib/jsonl.ts" }),
    JSON.stringify(complete),
  ].join("\n");
  const accepted = await stabilizeGeneration({
    project: base,
    stream: [lines.slice(0, 41), lines.slice(41)],
  });
  assert.equal(accepted.status, "committed");

  const rejected = await stabilizeGeneration({
    project: base,
    stream: ["```ts\nexport const markdown = true;\n```"],
  });
  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.diagnostics.some((entry) => entry.code === "EVENT_INVALID"));
});

test("active relative data extension and public asset fixers use only existing unambiguous files", async () => {
  const base = await project("stabilizer-safe-path-fixers");
  const result = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents("lib/local-config.json", '{"enabled":true}\n'),
      ...fileEvents("lib/use-config.ts", 'import config from "./local-config";\nexport const enabled=config.enabled;\n'),
      ...fileEvents("public/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'),
      ...fileEvents("components/logo.tsx", 'export const Logo=()=> <img src="/public/logo.svg" alt="Drops"/>;\n'),
      complete,
    ],
    policy: {
      fixerModes: {
        "relative-data-extension": "active",
        "next-public-asset-path": "active",
      },
    },
  });
  assert.equal(result.status, "committed");
  assert.match(result.project.files["lib/use-config.ts"].content, /local-config\.json/);
  assert.match(result.project.files["components/logo.tsx"].content, /src="\/logo\.svg"/);
  assert.deepEqual(result.transformations.map((entry) => entry.fixerId).sort(), [
    "next-public-asset-path",
    "relative-data-extension",
  ]);
});

test("package duplicate reconciliation preserves install-script policy and manifest synchronization", async () => {
  const base = await project("stabilizer-package");
  const manifest = JSON.parse(base.files["package.json"].content);
  manifest.devDependencies = {
    ...manifest.devDependencies,
    clsx: manifest.dependencies.clsx,
  };
  const result = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents("package.json", JSON.stringify(manifest, null, 2), base.files["package.json"].hash),
      complete,
    ],
    policy: { fixerModes: { "package-duplicate-dependency": "active" } },
  });
  assert.equal(result.status, "committed");
  const next = JSON.parse(result.project.files["package.json"].content);
  assert.equal(next.dependencies.clsx, manifest.dependencies.clsx);
  assert.equal(next.devDependencies.clsx, undefined);
  assert.equal(result.project.manifest.dependencies.clsx, manifest.dependencies.clsx);

  const unsafe = { ...manifest, scripts: { ...manifest.scripts, postinstall: "node unsafe.mjs" } };
  const blocked = await stabilizeGeneration({
    project: base,
    stream: [...fileEvents("package.json", JSON.stringify(unsafe), base.files["package.json"].hash), complete],
  });
  assert.equal(blocked.committed, false);
  assert.ok(blocked.diagnostics.some((entry) => entry.code === "INSTALL_SCRIPT_FORBIDDEN"));
});

test("missing dependencies, malformed syntax, Next boundaries and missing routes return diagnostics instead of mutation", async (t) => {
  const cases = [
    ["dependency", "lib/dependency.ts", 'import missing from "not-installed";\nexport default missing;\n', "DEPENDENCY_MISSING"],
    ["syntax", "lib/syntax.ts", "export const broken = ;\n", "SYNTAX_INVALID"],
    ["client", "components/client.tsx", 'import { useState } from "react";\nexport const Client=()=>{const [x]=useState(1);return <b>{x}</b>};\n', "NEXT_CLIENT_BOUNDARY"],
    ["route", "lib/route.ts", 'export const load=()=>fetch("/api/not-created");\n', "API_ROUTE_MISSING"],
  ];
  for (const [name, path, content, code] of cases) {
    await t.test(name, async () => {
      const base = await project(`stabilizer-diagnostic-${name}`);
      const result = await stabilizeGeneration({
        project: base,
        stream: [...fileEvents(path, content), complete],
      });
      assert.equal(result.committed, false);
      assert.ok(result.diagnostics.some((entry) => entry.code === code));
    });
  }
});

test("environment schema extraction records names only and tool-call secrets are blocked", async () => {
  const base = await project("stabilizer-environment");
  const result = await stabilizeGeneration({
    project: base,
    stream: [
      ...fileEvents("lib/env-name.ts", "export const configured=Boolean(process.env.DROPSTAB_PROXY_ENABLED);\n"),
      complete,
    ],
  });
  assert.equal(result.status, "committed");
  assert.ok(result.environmentVariableNames.includes("DROPSTAB_PROXY_ENABLED"));
  assert.equal(JSON.stringify(result).includes("DROPSTAB_PROXY_ENABLED="), false);

  const secret = "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890";
  const blocked = await stabilizeGeneration({
    project: base,
    stream: [
      { version: 1, type: "tool.call", tool: "write_file", input: { value: secret } },
      ...fileEvents("lib/safe.ts", "export const safe=true;\n"),
      complete,
    ],
  });
  assert.equal(blocked.committed, false);
  assert.equal(JSON.stringify(blocked).includes(secret), false);
  assert.ok(blocked.diagnostics.some((entry) => entry.code === "SECRET_DETECTED"));
});
