import assert from "node:assert/strict";
import test from "node:test";

const {
  EnterpriseCredentialStore,
  EnterprisePlatformError,
  LocalTestDomainVerificationAdapter,
  LocalTestOidcAdapter,
  enterpriseFeatureStates,
  evaluateEnterprisePolicy,
  resolveEnterprisePolicy,
} = await import("../lib/enterprise-platform/index.ts");

function hasCode(code) {
  return (error) => error instanceof EnterprisePlatformError && error.code === code;
}

function deterministicRuntime() {
  let sequence = 0;
  let now = new Date("2026-07-30T12:00:00.000Z");
  return {
    now: () => new Date(now),
    id: (prefix) => `${prefix}-${++sequence}`,
    entropy: (label) => `${label}_${++sequence}_${"e".repeat(48)}`,
    advance: (milliseconds) => { now = new Date(now.getTime() + milliseconds); },
  };
}

test("local test OIDC enforces state, nonce, PKCE, domain, group mapping and replay", () => {
  const runtime = deterministicRuntime();
  const oidc = new LocalTestOidcAdapter({
    issuer: "https://oidc.test.local",
    clientId: "drops-studio-test",
    allowedDomains: ["example.com"],
    groupRoleMappings: { developers: "developer", auditors: "security" },
    runtime,
  });
  assert.equal(oidc.state().status, "working-local-test");
  const request = oidc.begin({ organizationId: "org-1", redirectUri: "https://studio.test/callback" });
  assert.match(request.authorizationUrl, /code_challenge_method=S256/);
  const code = oidc.issueLocalTestCode({
    state: request.state,
    nonce: request.nonce,
    claims: { subject: "subject-1", email: "dev@example.com", groups: ["developers"] },
  });
  const identity = oidc.complete({ state: request.state, code, codeVerifier: request.codeVerifier });
  assert.equal(identity.roleId, "developer");
  assert.equal(identity.email, "dev@example.com");
  assert.throws(() => oidc.complete({ state: request.state, code, codeVerifier: request.codeVerifier }), hasCode("OIDC_REPLAY"));

  const second = oidc.begin({ organizationId: "org-1", redirectUri: "https://studio.test/callback" });
  const badDomainCode = oidc.issueLocalTestCode({
    state: second.state,
    nonce: second.nonce,
    claims: { subject: "subject-2", email: "dev@outside.test", groups: ["developers"] },
  });
  assert.throws(() => oidc.complete({ state: second.state, code: badDomainCode, codeVerifier: second.codeVerifier }), hasCode("OIDC_DOMAIN_DENIED"));
});

test("local domain challenges are domain bound, expiring, rotating and conflict safe", () => {
  const runtime = deterministicRuntime();
  const domains = new LocalTestDomainVerificationAdapter(runtime);
  const challenge = domains.createChallenge({ organizationId: "org-1", domain: "Example.com", expiresInMs: 10_000 });
  assert.equal(challenge.txtName, "_drops-studio-verification.example.com");
  assert.equal(domains.verify({ organizationId: "org-1", domain: "example.com", observedTxtValues: [challenge.txtValue] }).verified, true);
  assert.throws(() => domains.createChallenge({ organizationId: "org-2", domain: "example.com", expiresInMs: 10_000 }), hasCode("DOMAIN_CLAIMED"));
  const verifiedRotation = domains.rotateChallenge({ organizationId: "org-1", domain: "example.com", expiresInMs: 10_000 });
  assert.throws(() => domains.verify({ organizationId: "org-1", domain: "example.com", observedTxtValues: [challenge.txtValue] }), hasCode("DOMAIN_VERIFICATION_FAILED"));
  assert.equal(domains.verify({ organizationId: "org-1", domain: "example.com", observedTxtValues: [verifiedRotation.txtValue] }).verified, true);
  assert.throws(() => domains.rotateChallenge({ organizationId: "org-2", domain: "example.com", expiresInMs: 10_000 }), hasCode("DOMAIN_CLAIMED"));

  const expiring = domains.createChallenge({ organizationId: "org-1", domain: "other.example.com", expiresInMs: 1_000 });
  runtime.advance(1_001);
  assert.throws(() => domains.verify({ organizationId: "org-1", domain: "other.example.com", observedTxtValues: [expiring.txtValue] }), hasCode("DOMAIN_CHALLENGE_EXPIRED"));
  const rotated = domains.rotateChallenge({ organizationId: "org-1", domain: "other.example.com", expiresInMs: 10_000 });
  assert.notEqual(rotated.txtValue, expiring.txtValue);
});

test("service-account tokens are one-time, hashed, scoped, expiring and revocable", () => {
  const runtime = deterministicRuntime();
  const credentials = new EnterpriseCredentialStore({ runtime, tokenPepper: "p".repeat(48) });
  const account = credentials.createServiceAccount({
    organizationId: "org-1",
    name: "Preview automation",
    permissions: ["project.read", "project.edit"],
    projectIds: ["project-1"],
    environments: ["preview"],
  });
  const issued = credentials.issueToken({ serviceAccountId: account.id, permissions: ["project.read"], expiresInMs: 60_000 });
  assert.match(issued.token, /^dst_sa_/);
  assert.equal(issued.tokenRecord.prefix, "dst_sa_");
  assert.equal(JSON.stringify(credentials.snapshot()).includes(issued.token), false);
  assert.equal(credentials.authenticate({ token: issued.token, permission: "project.read", projectId: "project-1", environment: "preview" }).serviceAccountId, account.id);
  assert.throws(() => credentials.authenticate({ token: issued.token, permission: "project.edit", projectId: "project-1", environment: "preview" }), hasCode("TOKEN_SCOPE_DENIED"));
  assert.throws(() => credentials.authenticate({ token: issued.token, permission: "project.read", projectId: "project-2", environment: "preview" }), hasCode("TOKEN_PROJECT_DENIED"));
  const rotated = credentials.rotateToken({ tokenId: issued.tokenRecord.id, expiresInMs: 60_000 });
  assert.throws(() => credentials.authenticate({ token: issued.token, permission: "project.read", projectId: "project-1", environment: "preview" }), hasCode("TOKEN_REVOKED"));
  credentials.revokeToken(rotated.tokenRecord.id);
  assert.throws(() => credentials.authenticate({ token: rotated.token, permission: "project.read", projectId: "project-1", environment: "preview" }), hasCode("TOKEN_REVOKED"));
});

test("failed service-account token rotation leaves the previous token active", () => {
  const runtime = deterministicRuntime();
  const credentials = new EnterpriseCredentialStore({ runtime, tokenPepper: "p".repeat(48) });
  const account = credentials.createServiceAccount({
    organizationId: "org-1",
    name: "Safe rotation",
    permissions: ["project.read"],
  });
  const issued = credentials.issueToken({ serviceAccountId: account.id, permissions: ["project.read"], expiresInMs: 60_000 });
  runtime.entropy = () => "too-short";
  assert.throws(() => credentials.rotateToken({ tokenId: issued.tokenRecord.id, expiresInMs: 60_000 }), hasCode("INVALID_INPUT"));
  assert.equal(credentials.authenticate({ token: issued.token, permission: "project.read" }).tokenId, issued.tokenRecord.id);
});

test("policy precedence only tightens higher-priority constraints and records a stable hash", () => {
  const resolved = resolveEnterprisePolicy({
    systemHard: {
      allowedModelProviders: ["openai", "anthropic"],
      platformModelsAllowed: false,
      maxAgentCostPerRun: 10,
      allowedNetworkHosts: ["api.dropstab.com", "studio.example"],
      productionPublishRequiresApproval: true,
      exportAllowed: true,
    },
    organization: {
      allowedModelProviders: ["openai", "custom"],
      platformModelsAllowed: true,
      maxAgentCostPerRun: 5,
      allowedNetworkHosts: ["api.dropstab.com"],
      productionPublishRequiresApproval: false,
    },
    project: { maxAgentCostPerRun: 8, exportAllowed: false },
    userPreference: { allowedModelProviders: ["openai", "anthropic"] },
  });
  assert.deepEqual(resolved.policy.allowedModelProviders, ["openai"]);
  assert.equal(resolved.policy.platformModelsAllowed, false);
  assert.equal(resolved.policy.maxAgentCostPerRun, 5);
  assert.equal(resolved.policy.productionPublishRequiresApproval, true);
  assert.equal(resolved.policy.exportAllowed, false);
  assert.match(resolved.policyHash, /^[a-f0-9]{64}$/);
  assert.equal(evaluateEnterprisePolicy(resolved, { action: "model.use", provider: "anthropic" }).allowed, false);
  assert.equal(evaluateEnterprisePolicy(resolved, { action: "network.connect", host: "api.dropstab.com" }).allowed, true);
  assert.equal(evaluateEnterprisePolicy(resolved, { action: "production.publish" }).requiresApproval, true);
});

test("feature states never claim unconfigured SAML, SCIM or external OIDC success", () => {
  const states = enterpriseFeatureStates({ organizations: true, localCollaboration: true, localTestOidc: true });
  assert.equal(states.organizations.status, "working-local-test");
  assert.equal(states.realtimeCollaboration.mode, "deterministic-local-test");
  assert.equal(states.enterpriseOidc.status, "working-local-test");
  assert.equal(states.enterpriseSaml.status, "setup-required");
  assert.equal(states.scim.status, "setup-required");
  assert.equal(states.enterpriseSaml.providerEvidence, false);
});
