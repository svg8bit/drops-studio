import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { ManagedEmailAdapter, ManagedPlatformLimits, ManagedPrincipal, ManagedScope } from "./contracts.ts";
import { ManagedPlatformError, assertScope, clone, requirePermission, safeEqual, sha256 } from "./security.ts";
import type { ManagedLogStore } from "./logs.ts";

interface ManagedAppUser {
  id: string;
  scopeKey: string;
  email: string | null;
  anonymous: boolean;
  roles: string[];
  profile: Record<string, string>;
  status: "active" | "disabled" | "deleted";
  createdAt: string;
}

interface StoredSession {
  id: string;
  scopeKey: string;
  userId: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

interface StoredEmailChallenge {
  id: string;
  scopeKey: string;
  email: string;
  codeHash: string;
  evidenceId: string;
  attempts: number;
  expiresAt: string;
  consumedAt: string | null;
}

const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export class ManagedAuthService {
  private readonly users = new Map<string, Map<string, ManagedAppUser>>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly emailChallenges = new Map<string, StoredEmailChallenge>();

  private readonly options: { now: () => Date; logs: ManagedLogStore; limits: ManagedPlatformLimits; emailAdapter?: ManagedEmailAdapter };
  constructor(options: { now: () => Date; logs: ManagedLogStore; limits: ManagedPlatformLimits; emailAdapter?: ManagedEmailAdapter }) { this.options = options; }

  async requestEmailCode(scope: ManagedScope, email: string, principal: ManagedPrincipal): Promise<{ status: "setup-required"; reasonCode: string } | { status: "sent"; challengeId: string; evidenceId: string; expiresAt: string }> {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL.test(normalizedEmail)) throw new ManagedPlatformError("EMAIL_INVALID", "Email address is invalid.");
    if (!this.options.emailAdapter) return { status: "setup-required", reasonCode: "EMAIL_ADAPTER_REQUIRED" };
    const challengeId = `email_challenge_${randomUUID()}`;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(this.options.now().getTime() + 10 * 60_000).toISOString();
    const { evidenceId } = await this.options.emailAdapter.deliverOneTimeCode({ scope, email: normalizedEmail, code, expiresAt });
    this.emailChallenges.set(challengeId, {
      id: challengeId,
      scopeKey: scope.scopeKey,
      email: normalizedEmail,
      codeHash: sha256(`${challengeId}:${normalizedEmail}:${code}`),
      evidenceId,
      attempts: 0,
      expiresAt,
      consumedAt: null,
    });
    return { status: "sent", challengeId, evidenceId, expiresAt };
  }

  verifyEmailCode(scope: ManagedScope, input: { challengeId: string; email: string; code: string }, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    const email = input.email.trim().toLowerCase();
    const challenge = this.emailChallenges.get(input.challengeId);
    if (!challenge || challenge.scopeKey !== scope.scopeKey || challenge.email !== email) throw new ManagedPlatformError("EMAIL_CHALLENGE_INVALID", "Email code challenge is invalid.");
    if (challenge.consumedAt) throw new ManagedPlatformError("EMAIL_CHALLENGE_CONSUMED", "Email code challenge was already used.");
    if (Date.parse(challenge.expiresAt) <= this.options.now().getTime()) throw new ManagedPlatformError("EMAIL_CHALLENGE_EXPIRED", "Email code challenge expired.");
    if (challenge.attempts >= 5) throw new ManagedPlatformError("EMAIL_CHALLENGE_ATTEMPTS_EXCEEDED", "Email code challenge attempt limit was exceeded.");
    const actual = sha256(`${challenge.id}:${email}:${input.code}`);
    if (!safeEqual(actual, challenge.codeHash)) {
      challenge.attempts += 1;
      throw new ManagedPlatformError("EMAIL_CODE_INVALID", "Email verification code is invalid.");
    }
    challenge.consumedAt = this.options.now().toISOString();
    this.options.logs.append(scope, { category: "auth", severity: "info", action: "auth.email.verify", actorId: principal.actorId, requestId: `req_${randomUUID()}`, metadata: { challengeId: challenge.id, emailHash: sha256(email), evidenceId: challenge.evidenceId } });
    return { status: "verified" as const, email, challengeId: challenge.id, evidenceId: challenge.evidenceId, verifiedAt: challenge.consumedAt };
  }

  createUser(scope: ManagedScope, input: { email: string; roles: string[]; profile?: Record<string, string> }, principal: ManagedPrincipal): ManagedAppUser {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    const email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new ManagedPlatformError("EMAIL_INVALID", "Email address is invalid.");
    if (!input.roles.length || input.roles.length > 16) throw new ManagedPlatformError("ROLE_INVALID", "At least one bounded project role is required.");
    const scoped = this.users.get(scope.scopeKey) ?? new Map<string, ManagedAppUser>();
    if ([...scoped.values()].some((user) => user.email === email && user.status !== "deleted")) throw new ManagedPlatformError("USER_EXISTS", "Project user already exists.");
    const user: ManagedAppUser = {
      id: `app_user_${randomUUID()}`,
      scopeKey: scope.scopeKey,
      email,
      anonymous: false,
      roles: [...new Set(input.roles)].slice(0, 16),
      profile: clone(input.profile ?? {}),
      status: "active",
      createdAt: this.options.now().toISOString(),
    };
    scoped.set(user.id, user);
    this.users.set(scope.scopeKey, scoped);
    this.options.logs.append(scope, { category: "auth", severity: "info", action: "auth.user.create", actorId: principal.actorId, requestId: `req_${randomUUID()}`, metadata: { userId: user.id, emailHash: sha256(email) } });
    return clone(user);
  }

  createGuest(scope: ManagedScope, principal: ManagedPrincipal): ManagedAppUser {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    const scoped = this.users.get(scope.scopeKey) ?? new Map<string, ManagedAppUser>();
    const activeGuests = [...scoped.values()].filter((user) => user.anonymous && user.status === "active").length;
    if (activeGuests >= this.options.limits.maxGuestUsersPerEnvironment) throw new ManagedPlatformError("GUEST_QUOTA_EXCEEDED", "Guest user quota exceeded for this environment.");
    const user: ManagedAppUser = { id: `app_guest_${randomUUID()}`, scopeKey: scope.scopeKey, email: null, anonymous: true, roles: ["guest"], profile: {}, status: "active", createdAt: this.options.now().toISOString() };
    scoped.set(user.id, user);
    this.users.set(scope.scopeKey, scoped);
    return clone(user);
  }

  createSession(scope: ManagedScope, userId: string, principal: ManagedPrincipal, options: { ttlSeconds?: number } = {}) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    const user = this.users.get(scope.scopeKey)?.get(userId);
    if (!user || user.status !== "active") throw new ManagedPlatformError("USER_UNAVAILABLE", "Project user is unavailable.");
    const ttl = options.ttlSeconds ?? 3_600;
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 2_592_000) throw new ManagedPlatformError("SESSION_TTL_INVALID", "Session lifetime is invalid.");
    const token = `ds_session_${randomBytes(32).toString("base64url")}`;
    const csrfToken = `ds_csrf_${randomBytes(24).toString("base64url")}`;
    const session: StoredSession = {
      id: `session_${randomUUID()}`,
      scopeKey: scope.scopeKey,
      userId,
      tokenHash: sha256(token),
      csrfHash: sha256(csrfToken),
      expiresAt: new Date(this.options.now().getTime() + ttl * 1_000).toISOString(),
      revokedAt: null,
      createdAt: this.options.now().toISOString(),
    };
    this.sessions.set(session.id, session);
    this.tokenIndex.set(session.tokenHash, session.id);
    return { id: session.id, token, csrfToken, expiresAt: session.expiresAt };
  }

  verifySession(scope: ManagedScope, token: string, options: { write?: boolean; csrfToken?: string } = {}) {
    const id = this.tokenIndex.get(sha256(token));
    const session = id ? this.sessions.get(id) : undefined;
    if (!session) throw new ManagedPlatformError("SESSION_INVALID", "Managed auth session is invalid.");
    if (session.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("SESSION_SCOPE_MISMATCH", "Managed auth session scope or environment does not match.");
    if (session.revokedAt) throw new ManagedPlatformError("SESSION_REVOKED", "Managed auth session was revoked.");
    if (Date.parse(session.expiresAt) <= this.options.now().getTime()) throw new ManagedPlatformError("SESSION_EXPIRED", "Managed auth session expired.");
    if (options.write && (!options.csrfToken || !safeEqual(sha256(options.csrfToken), session.csrfHash))) throw new ManagedPlatformError("CSRF_INVALID", "CSRF validation failed.");
    const user = this.users.get(scope.scopeKey)?.get(session.userId);
    if (!user || user.status !== "active") throw new ManagedPlatformError("USER_UNAVAILABLE", "Project user is unavailable.");
    return { sessionId: session.id, userId: user.id, roles: [...user.roles], expiresAt: session.expiresAt };
  }

  revokeSession(scope: ManagedScope, sessionId: string, principal: ManagedPrincipal): void {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    const session = this.sessions.get(sessionId);
    if (!session || session.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("SESSION_NOT_FOUND", "Managed auth session does not exist.");
    session.revokedAt = this.options.now().toISOString();
  }

  exportMetadata(scope: ManagedScope, principal: ManagedPrincipal): { users: ManagedAppUser[] } {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    return { users: clone([...(this.users.get(scope.scopeKey)?.values() ?? [])]) };
  }

  importMetadata(scope: ManagedScope, input: { users: ManagedAppUser[] }, principal: ManagedPrincipal): void {
    assertScope(scope, principal);
    requirePermission(principal, "backend.auth.manage");
    this.users.set(scope.scopeKey, new Map(input.users.map((user) => [user.id, { ...clone(user), scopeKey: scope.scopeKey }])));
  }
}
