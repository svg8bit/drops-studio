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

const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { selectRuntimeSkills } = await import("../lib/agent/skills/index.ts");
const managed = await import("../lib/managed-platform/index.ts");
const enterprise = await import("../lib/enterprise-platform/index.ts");

function deterministicRuntime() {
  let sequence = 0;
  return {
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
    token: () => `invite_${String(++sequence).padStart(4, "0")}_${"x".repeat(32)}`,
    entropy: (label) => `${label}_${String(++sequence).padStart(4, "0")}_${"e".repeat(48)}`,
  };
}

test("agent-generated collaborative crypto SaaS crosses V4 data, identity, collaboration, policy, audit and recovery", async () => {
  const prompt = "Build a multi-user whale intelligence SaaS with organizations, RBAC, managed auth, wallet webhooks, scheduled enrichment jobs, realtime collaborative comments, audit history, backups and approved Telegram alerts.";
  const spec = createProjectSpec({
    presetId: "custom-product",
    values: {},
    prompt,
    tools: ["DropsTab API", "Drops Bot", "Telegram"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const project = await materializeProjectV2Template({ id: "e2e-whale-saas", spec, now: "2026-07-30T12:00:00.000Z" });
  assert.ok(project.files["backend/schema.json"]);
  assert.equal(project.integrations.find((item) => item.id === "managed-backend")?.status, "setup-required");

  const selection = selectRuntimeSkills({
    role: "planner",
    task: prompt,
    integrations: ["managed-backend", "managed-auth", "managed-jobs", "managed-webhooks", "managed-realtime", "collaboration", "organizations", "audit"],
    availableCapabilities: ["project-v2", "project-data", "vercel-sandbox"],
    maximumSkills: 12,
    maximumEstimatedTokens: 4_800,
  });
  for (const skillId of ["managed-backend", "managed-auth", "webhooks", "jobs-and-cron", "collaboration", "enterprise-rbac", "audit-and-compliance"]) {
    assert.ok(selection.skills.some((skill) => skill.id === skillId), `missing ${skillId}`);
  }

  const runtime = deterministicRuntime();
  const directory = new enterprise.EnterpriseDirectory(runtime);
  const tenant = directory.createOrganization({ ownerUserId: "owner", name: "Whale Research", kind: "organization" });
  const invitation = directory.inviteMember({ actorUserId: "owner", organizationId: tenant.organization.id, workspaceId: tenant.workspace.id, email: "dev@example.com", roleId: "developer", expiresInMs: 60_000 });
  directory.acceptInvitation({ token: invitation.token, userId: "developer", email: "dev@example.com" });
  assert.equal(directory.can("developer", tenant.organization.id, "project.edit"), true);
  assert.equal(directory.can("developer", tenant.organization.id, "billing.manage"), false);

  const scope = managed.managedScope({ organizationId: tenant.organization.id, workspaceId: tenant.workspace.id, projectId: project.id, environment: "development" });
  const restoreScope = managed.managedScope({ ...scope, environment: "preview" });
  const principal = (actorId, targetScope = scope) => managed.managedPrincipal({
    actorId,
    actorType: "user",
    scope: targetScope,
    roles: actorId === "owner" ? ["owner"] : ["developer"],
    permissions: actorId === "owner"
      ? ["backend.schema.manage", "backend.data.read", "backend.data.write", "backend.data.admin", "backend.backups.manage"]
      : ["backend.data.read", "backend.data.write"],
  });
  const dataPlane = managed.createInMemoryManagedPlatform({ signingKey: Buffer.alloc(32, 4), encryptionKey: Buffer.alloc(32, 8) });
  dataPlane.environments.ensure(scope, principal("owner"));
  const generatedSchema = JSON.parse(project.files["backend/schema.json"].content);
  const migration = dataPlane.schema.plan(scope, {
    baseVersion: 0,
    operations: [{ kind: "create-collection", collection: { name: "alerts", ...generatedSchema.collections.alerts } }],
  }, principal("owner"));
  dataPlane.schema.apply(scope, migration, principal("owner"));
  const alert = dataPlane.data.create(scope, "alerts", { status: "draft", score: 91.5, evidence: { dropstab: "demo-labelled", walletEventId: "evt-1" } }, principal("developer"), { idempotencyKey: "alert-evt-1" });
  assert.equal(alert._revision, 1);
  assert.equal(dataPlane.data.query(scope, "alerts", { filters: [{ field: "status", operator: "eq", value: "draft" }], limit: 10 }, principal("developer")).rows.length, 1);

  const document = enterprise.createCollaborativeTextDocument("alert-copy", "Whale alert");
  const alice = enterprise.createInsertOperations(document, { actorId: "owner", lamport: 2, index: 5, text: " verified" });
  const bob = enterprise.createInsertOperations(document, { actorId: "developer", lamport: 2, index: 5, text: " sourced" });
  const firstOrder = enterprise.renderCollaborativeText(enterprise.applyTextOperations(document, [...alice, ...bob]));
  const secondOrder = enterprise.renderCollaborativeText(enterprise.applyTextOperations(document, [...bob, ...alice]));
  assert.equal(firstOrder, secondOrder);
  assert.match(firstOrder, /verified/);
  assert.match(firstOrder, /sourced/);

  const branches = new enterprise.AiBranchManager(runtime);
  branches.createProject({ projectId: project.id, files: { "app/page.tsx": project.files["app/page.tsx"].content, "backend/schema.json": project.files["backend/schema.json"].content } });
  const aiBranch = branches.createBranch({ projectId: project.id, taskOwnerId: "agent", taskScope: ["backend/**"] });
  branches.writeBranchFile({ branchId: aiBranch.id, path: "backend/schema.json", content: project.files["backend/schema.json"].content.replace("draft", "queued") });
  const approvalRequired = branches.mergeBranch({ branchId: aiBranch.id, actorUserId: "owner", approved: false });
  assert.equal(approvalRequired.status, "approval-required");
  const merged = branches.mergeBranch({ branchId: aiBranch.id, actorUserId: "owner", approved: true });
  assert.equal(merged.status, "merged");

  const oidc = new enterprise.LocalTestOidcAdapter({ issuer: "https://oidc.test.local", clientId: "drops-studio-test", allowedDomains: ["example.com"], groupRoleMappings: { developers: "developer" }, runtime });
  const authorization = oidc.begin({ organizationId: tenant.organization.id, redirectUri: "https://studio.test/callback" });
  const code = oidc.issueLocalTestCode({ state: authorization.state, nonce: authorization.nonce, claims: { subject: "developer", email: "dev@example.com", groups: ["developers"] } });
  assert.equal(oidc.complete({ state: authorization.state, code, codeVerifier: authorization.codeVerifier }).roleId, "developer");

  const policy = enterprise.resolveEnterprisePolicy({
    systemHard: { allowedModelProviders: ["openai", "anthropic"], platformModelsAllowed: false, maxAgentCostPerRun: 10, allowedNetworkHosts: ["api.dropstab.com"], productionPublishRequiresApproval: true, exportAllowed: true },
    organization: { allowedModelProviders: ["openai"], maxAgentCostPerRun: 3 },
  });
  assert.equal(enterprise.evaluateEnterprisePolicy(policy, { action: "production.publish" }).requiresApproval, true);
  assert.equal(enterprise.evaluateEnterprisePolicy(policy, { action: "model.use", provider: "anthropic" }).allowed, false);

  const audit = new enterprise.ImmutableAuditLog(runtime);
  audit.append({ organizationId: tenant.organization.id, workspaceId: tenant.workspace.id, actorType: "agent", actorId: "agent", action: "branch.merge", targetType: "project", targetId: project.id, outcome: "success", requestId: "e2e-v4", metadata: { checkpointId: merged.checkpointId, policyHash: policy.policyHash } });
  assert.equal(audit.verifyIntegrity(), true);

  dataPlane.secrets.create(scope, { name: "BACKUP_SCAN", value: "verified-backup-secret-plaintext", allowedPurposes: ["function"] }, principal("owner"));
  const backup = dataPlane.backups.create(scope, principal("owner"));
  assert.equal(JSON.stringify(backup).includes("verified-backup-secret-plaintext"), false);
  dataPlane.backups.restore(backup.id, restoreScope, principal("owner", restoreScope));
  assert.equal(dataPlane.data.query(restoreScope, "alerts", { filters: [], limit: 10 }, principal("owner", restoreScope)).rows[0].score, 91.5);
});
