import { createHash } from "node:crypto";

import { enterpriseError } from "./errors.ts";
import type { DefaultRoleId, EnterpriseFeatureState, SecretRuntime } from "./types.ts";
import { DEFAULT_ROLE_IDS } from "./types.ts";
import { assertSafeId, boundedText, clone, iso, normalizeDomain, normalizeEmail, sha256 } from "./utils.ts";

export interface EnterpriseIdentity {
  provider: "oidc-local-test";
  organizationId: string;
  subject: string;
  email: string;
  groups: string[];
  roleId: DefaultRoleId;
  authenticatedAt: string;
  providerEvidence: false;
}

export interface EnterpriseIdentityAdapter {
  state(): EnterpriseFeatureState;
  begin(input: { organizationId: string; redirectUri: string }): {
    authorizationUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  };
}

interface PendingOidcRequest {
  organizationId: string;
  redirectUri: string;
  stateHash: string;
  nonceHash: string;
  verifierHash: string;
  expiresAt: string;
  codeHash?: string;
  claims?: LocalTestOidcClaims;
}

export interface LocalTestOidcClaims {
  subject: string;
  email: string;
  groups: string[];
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export class LocalTestOidcAdapter implements EnterpriseIdentityAdapter {
  readonly #issuer: string;
  readonly #clientId: string;
  readonly #allowedDomains: Set<string>;
  readonly #groupRoleMappings: Readonly<Record<string, DefaultRoleId>>;
  readonly #runtime: SecretRuntime;
  readonly #pending = new Map<string, PendingOidcRequest>();
  readonly #usedStates = new Set<string>();

  constructor(input: {
    issuer: string;
    clientId: string;
    allowedDomains: string[];
    groupRoleMappings: Record<string, DefaultRoleId>;
    runtime: SecretRuntime;
  }) {
    const issuer = new URL(input.issuer);
    if (issuer.protocol !== "https:" || issuer.hostname !== "oidc.test.local") {
      enterpriseError("OIDC_SETUP_REQUIRED", "Local OIDC adapter accepts only the explicit oidc.test.local issuer.");
    }
    this.#issuer = issuer.origin;
    this.#clientId = boundedText(input.clientId, "OIDC client id", 160);
    this.#allowedDomains = new Set(input.allowedDomains.map(normalizeDomain));
    if (!this.#allowedDomains.size) enterpriseError("INVALID_INPUT", "OIDC allowed domains are required.");
    for (const role of Object.values(input.groupRoleMappings)) {
      if (!(DEFAULT_ROLE_IDS as readonly string[]).includes(role)) enterpriseError("INVALID_INPUT", "OIDC group role mapping is invalid.");
    }
    this.#groupRoleMappings = clone(input.groupRoleMappings);
    this.#runtime = input.runtime;
  }

  state(): EnterpriseFeatureState {
    return {
      status: "working-local-test",
      mode: "standards-shaped-local-test-oidc",
      providerEvidence: false,
      reason: "Authorization codes are issued by the in-process test adapter; no external identity provider is contacted.",
    };
  }

  begin(input: { organizationId: string; redirectUri: string }): {
    authorizationUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  } {
    const organizationId = assertSafeId(input.organizationId, "Organization id");
    const redirect = new URL(input.redirectUri);
    if (redirect.protocol !== "https:") enterpriseError("INVALID_INPUT", "OIDC redirect URI must use HTTPS.");
    const state = this.#runtime.entropy("oidc_state");
    const nonce = this.#runtime.entropy("oidc_nonce");
    const codeVerifier = this.#runtime.entropy("oidc_verifier");
    if ([state, nonce, codeVerifier].some((value) => value.length < 43)) enterpriseError("INVALID_INPUT", "OIDC entropy source is insufficient.");
    const stateHash = sha256(state);
    this.#pending.set(stateHash, {
      organizationId,
      redirectUri: redirect.toString(),
      stateHash,
      nonceHash: sha256(nonce),
      verifierHash: sha256(codeVerifier),
      expiresAt: iso(new Date(this.#runtime.now().getTime() + 10 * 60_000)),
    });
    const parameters = new URLSearchParams({
      response_type: "code",
      client_id: this.#clientId,
      redirect_uri: redirect.toString(),
      scope: "openid email profile groups",
      state,
      nonce,
      code_challenge: base64UrlSha256(codeVerifier),
      code_challenge_method: "S256",
    });
    return {
      authorizationUrl: `${this.#issuer}/authorize?${parameters.toString()}`,
      state,
      nonce,
      codeVerifier,
    };
  }

  issueLocalTestCode(input: { state: string; nonce: string; claims: LocalTestOidcClaims }): string {
    const pending = this.#pending.get(sha256(input.state));
    if (!pending) enterpriseError("OIDC_STATE_INVALID", "OIDC state is invalid.");
    this.#assertFresh(pending);
    if (pending.nonceHash !== sha256(input.nonce)) enterpriseError("OIDC_NONCE_INVALID", "OIDC nonce is invalid.");
    const code = this.#runtime.entropy("oidc_code");
    if (code.length < 43) enterpriseError("INVALID_INPUT", "OIDC code entropy is insufficient.");
    pending.codeHash = sha256(code);
    pending.claims = {
      subject: assertSafeId(input.claims.subject, "OIDC subject"),
      email: normalizeEmail(input.claims.email),
      groups: [...new Set(input.claims.groups.map((group) => boundedText(group, "OIDC group", 160)))].sort(),
    };
    return code;
  }

  complete(input: { state: string; code: string; codeVerifier: string }): EnterpriseIdentity {
    const stateHash = sha256(input.state);
    if (this.#usedStates.has(stateHash)) enterpriseError("OIDC_REPLAY", "OIDC authorization response has already been consumed.");
    const pending = this.#pending.get(stateHash);
    if (!pending) enterpriseError("OIDC_STATE_INVALID", "OIDC state is invalid.");
    this.#assertFresh(pending);
    if (pending.verifierHash !== sha256(input.codeVerifier)) enterpriseError("OIDC_PKCE_INVALID", "OIDC PKCE verifier is invalid.");
    if (!pending.codeHash || pending.codeHash !== sha256(input.code) || !pending.claims) enterpriseError("OIDC_CODE_INVALID", "OIDC authorization code is invalid.");
    const domain = normalizeDomain(pending.claims.email.split("@")[1]);
    if (!this.#allowedDomains.has(domain)) enterpriseError("OIDC_DOMAIN_DENIED", "OIDC email domain is not allowed for this organization.");
    const roleId = pending.claims.groups
      .map((group) => this.#groupRoleMappings[group])
      .find((role): role is DefaultRoleId => Boolean(role)) ?? "viewer";
    this.#pending.delete(stateHash);
    this.#usedStates.add(stateHash);
    return {
      provider: "oidc-local-test",
      organizationId: pending.organizationId,
      subject: pending.claims.subject,
      email: pending.claims.email,
      groups: [...pending.claims.groups],
      roleId,
      authenticatedAt: iso(this.#runtime.now()),
      providerEvidence: false,
    };
  }

  #assertFresh(pending: PendingOidcRequest): void {
    if (this.#runtime.now().getTime() > Date.parse(pending.expiresAt)) enterpriseError("OIDC_STATE_INVALID", "OIDC authorization request has expired.");
  }
}

export interface SamlAdapter {
  state(): EnterpriseFeatureState;
}

export interface ScimAdapter {
  state(): EnterpriseFeatureState;
}

export class SetupRequiredSamlAdapter implements SamlAdapter {
  state(): EnterpriseFeatureState {
    return { status: "setup-required", mode: "not-configured", providerEvidence: false, reason: "SAML adapter not configured." };
  }
}

export class SetupRequiredScimAdapter implements ScimAdapter {
  state(): EnterpriseFeatureState {
    return { status: "setup-required", mode: "not-configured", providerEvidence: false, reason: "SCIM adapter not configured." };
  }
}

interface DomainChallenge {
  organizationId: string;
  domain: string;
  tokenHash: string;
  expiresAt: string;
  verifiedAt: string | null;
}

export class LocalTestDomainVerificationAdapter {
  readonly #runtime: SecretRuntime;
  readonly #challenges = new Map<string, DomainChallenge>();

  constructor(runtime: SecretRuntime) {
    this.#runtime = runtime;
  }

  state(): EnterpriseFeatureState {
    return {
      status: "working-local-test",
      mode: "supplied-txt-values-local-test",
      providerEvidence: false,
      reason: "TXT values are supplied by tests; no external DNS resolver is contacted.",
    };
  }

  createChallenge(input: { organizationId: string; domain: string; expiresInMs: number }): { domain: string; txtName: string; txtValue: string; expiresAt: string } {
    const organizationId = assertSafeId(input.organizationId, "Organization id");
    const domain = normalizeDomain(input.domain);
    const existing = this.#challenges.get(domain);
    if (existing && existing.organizationId !== organizationId) enterpriseError("DOMAIN_CLAIMED", "Domain is already claimed by another organization.");
    if (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs < 1_000 || input.expiresInMs > 86_400_000) enterpriseError("INVALID_INPUT", "Domain challenge expiry is invalid.");
    const token = this.#runtime.entropy("domain_verification");
    if (token.length < 32) enterpriseError("INVALID_INPUT", "Domain challenge entropy is insufficient.");
    const expiresAt = iso(new Date(this.#runtime.now().getTime() + input.expiresInMs));
    this.#challenges.set(domain, { organizationId, domain, tokenHash: sha256(token), expiresAt, verifiedAt: existing?.verifiedAt ?? null });
    return { domain, txtName: `_drops-studio-verification.${domain}`, txtValue: `drops-studio=${token}`, expiresAt };
  }

  rotateChallenge(input: { organizationId: string; domain: string; expiresInMs: number }): { domain: string; txtName: string; txtValue: string; expiresAt: string } {
    const domain = normalizeDomain(input.domain);
    const existing = this.#challenges.get(domain);
    if (existing && existing.organizationId !== input.organizationId) enterpriseError("DOMAIN_CLAIMED", "Domain is already claimed by another organization.");
    return this.createChallenge(input);
  }

  verify(input: { organizationId: string; domain: string; observedTxtValues: string[] }): { verified: true; verifiedAt: string; providerEvidence: false } {
    const domain = normalizeDomain(input.domain);
    const challenge = this.#challenges.get(domain);
    if (!challenge || challenge.organizationId !== input.organizationId) enterpriseError("DOMAIN_VERIFICATION_FAILED", "Domain challenge was not found for this organization.");
    if (this.#runtime.now().getTime() > Date.parse(challenge.expiresAt)) enterpriseError("DOMAIN_CHALLENGE_EXPIRED", "Domain challenge has expired.");
    const matched = input.observedTxtValues.some((value) => value.startsWith("drops-studio=") && sha256(value.slice("drops-studio=".length)) === challenge.tokenHash);
    if (!matched) enterpriseError("DOMAIN_VERIFICATION_FAILED", "Expected domain verification TXT value was not observed.");
    challenge.verifiedAt = iso(this.#runtime.now());
    return { verified: true, verifiedAt: challenge.verifiedAt, providerEvidence: false };
  }
}

export function enforceSso(input: {
  required: boolean;
  identityProvider: "oidc" | "openrouter" | "email";
  isOwner: boolean;
  emergencyOwnerRecoveryEnabled: boolean;
  recoveryReason?: string;
}): { allowed: boolean; recoveryUsed: boolean; reason: string } {
  if (!input.required || input.identityProvider === "oidc") return { allowed: true, recoveryUsed: false, reason: "SSO policy satisfied." };
  if (input.isOwner && input.emergencyOwnerRecoveryEnabled && input.recoveryReason?.trim()) {
    return { allowed: true, recoveryUsed: true, reason: "Emergency owner recovery requires an audit event." };
  }
  return { allowed: false, recoveryUsed: false, reason: "Organization SSO policy requires OIDC." };
}
