import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const {
  migrateGeneratedProjectToV2,
  refreshLegacyProjectV2Migration,
} = await import("../lib/project-v2-migration.ts");
const { validateProjectV2 } = await import("../lib/project-v2-validator.ts");
const { hashProjectV2CanonicalState } = await import("../lib/project-v2-hash.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const { compileProject } = await import("../lib/project-compiler.ts");
const { materializeProjectWorkspace } = await import("../lib/project-workspace.ts");

function legacyProject() {
  const spec = createProjectSpec({
    presetId: "morning-alpha",
    values: {},
    prompt: "Build a morning crypto brief",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const html = compileProject(spec);
  return {
    id: "legacy-project",
    spec,
    html,
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    publishedSlug: "morning-alpha-live",
    publishedUrl: "/p/morning-alpha-live",
  };
}

test("migrates an HTML-only V1 project without losing identity or publish metadata", async () => {
  const project = await migrateGeneratedProjectToV2(legacyProject());
  assert.equal(project.schemaVersion, 2);
  assert.equal(project.id, "legacy-project");
  assert.equal(project.manifest.framework.name, "legacy-html");
  assert.equal(project.deployment.legacyPublishedSlug, "morning-alpha-live");
  assert.equal(project.migration.sourceSchemaVersion, 1);
  assert.equal(project.migration.sourceFidelity, "exact");
  assert.ok(project.files["index.html"]);
  await validateProjectV2(project);
});

test("migrates the current canonical workspace as the exact V2 filesystem", async () => {
  const legacy = legacyProject();
  const workspace = materializeProjectWorkspace(legacy);
  const project = await migrateGeneratedProjectToV2({ ...legacy, workspace });
  assert.deepEqual(Object.keys(project.files), workspace.files.map((file) => file.path));
  assert.equal(project.files["src/app.js"].content, workspace.files.find((file) => file.path === "src/app.js").content);
  assert.equal(project.migration.sourceKind, "project-workspace-v1");
});

test("refreshes a migrated legacy filesystem after a product edit", async () => {
  const legacy = legacyProject();
  const workspace = materializeProjectWorkspace(legacy);
  const migrated = await migrateGeneratedProjectToV2({ ...legacy, workspace });
  const configured = structuredClone(migrated);
  configured.integrations[0].status = "available";
  configured.environment.push({
    name: "PUBLIC_RPC_HOST",
    description: "Approved public RPC host name.",
    required: false,
    secret: false,
    scope: "runtime",
  });
  configured.permissions.push({
    id: "read-public-rpc",
    capability: "rpc:read",
    effect: "allow",
    destructive: false,
    external: true,
  });
  configured.contentHash = await hashProjectV2CanonicalState(configured);
  await validateProjectV2(configured);
  const editedSpec = {
    ...legacy.spec,
    name: "Morning Alpha Desk",
    slug: "morning-alpha-desk",
  };
  const changedAt = "2026-07-30T12:05:00.000Z";
  const edited = {
    ...legacy,
    spec: editedSpec,
    html: compileProject(editedSpec),
    workspace: materializeProjectWorkspace({
      ...legacy,
      spec: editedSpec,
      html: compileProject(editedSpec),
      updatedAt: changedAt,
    }),
    updatedAt: changedAt,
  };
  const refreshed = await refreshLegacyProjectV2Migration({
    project: configured,
    generatedProject: edited,
  });

  assert.equal(refreshed.revision, configured.revision + 1);
  assert.equal(refreshed.manifest.framework.name, "legacy-html");
  assert.equal(refreshed.manifest.name, "Morning Alpha Desk");
  assert.equal(refreshed.productSpec.name, "Morning Alpha Desk");
  assert.match(refreshed.files["index.html"].content, /Morning Alpha Desk/);
  assert.deepEqual(refreshed.integrations, configured.integrations);
  assert.deepEqual(refreshed.environment, configured.environment);
  assert.deepEqual(refreshed.permissions, configured.permissions);
  assert.deepEqual(refreshed.deployment, configured.deployment);
  assert.deepEqual(refreshed.migration, configured.migration);
  await validateProjectV2(refreshed);
});
