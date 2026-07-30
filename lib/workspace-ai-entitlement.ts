import type { NextRequest } from "next/server.js";
import {
  createGuestUsageCookie,
  GUEST_DAILY_LIMIT,
  GUEST_IDENTITY_COOKIE,
  GUEST_USAGE_COOKIE,
  MEMBER_DAILY_LIMIT,
  MEMBER_USAGE_COOKIE,
  platformAiReadiness,
  resolveAccountCookieSecret,
  resolveGuestAccess,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
  type StudioAccount,
} from "./access-tier.ts";
import {
  billingTierForAccount,
  memberPlatformBuildLimit,
  stripeProPriceId,
  type BillingAccountRecord,
} from "./billing.ts";
import {
  billingStorageConfigured,
  readBillingAccount,
} from "../db/billing.ts";
import {
  consumeRequestLimitState,
  type RequestLimitState,
} from "./request-rate-limit.ts";

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1_000;
type WorkspaceQuotaPurpose = "generation" | "execution";

export interface WorkspaceAiQuotaCookie {
  name: typeof GUEST_IDENTITY_COOKIE | typeof GUEST_USAGE_COOKIE | typeof MEMBER_USAGE_COOKIE;
  value: string;
  maxAge: number;
}

export interface WorkspaceAiQuotaReservation {
  tier: "guest" | "member" | "pro";
  identity: string;
  account: StudioAccount | null;
  limit: number;
  used: number;
  remaining: number;
  reset: "daily-utc";
  cookies: WorkspaceAiQuotaCookie[];
}

export interface WorkspaceAiQuotaDependencies {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  createGuestIdentity?: () => string;
  consumeQuota?: (input: {
    identity: string | null;
    namespace: string;
    max: number;
    windowMs: number;
  }) => Promise<RequestLimitState>;
  billingStorageConfigured?: () => boolean;
  readBillingAccount?: (
    identity: string,
  ) => Promise<BillingAccountRecord | null>;
}

export class WorkspaceAiQuotaLimitError extends Error {
  readonly tier: WorkspaceAiQuotaReservation["tier"];
  readonly limit: number;

  constructor(tier: WorkspaceAiQuotaReservation["tier"], limit: number) {
    super(`${tier} platform AI daily allowance reached.`);
    this.name = "WorkspaceAiQuotaLimitError";
    this.tier = tier;
    this.limit = limit;
  }
}

export class WorkspaceAiQuotaUnavailableError extends Error {
  constructor(message = "Platform AI entitlement could not be reserved safely.") {
    super(message);
    this.name = "WorkspaceAiQuotaUnavailableError";
  }
}

function dateUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function durableQuotaReady(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    (env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !env.VERCEL)
      || env.BLOB_READ_WRITE_TOKEN?.trim()
      || (env.BLOB_STORE_ID?.trim() && env.VERCEL_OIDC_TOKEN?.trim()),
  );
}

function reservationFromState(input: {
  state: RequestLimitState;
  tier: WorkspaceAiQuotaReservation["tier"];
  identity: string;
  account: StudioAccount | null;
  limit: number;
  cookies: WorkspaceAiQuotaCookie[];
}): WorkspaceAiQuotaReservation {
  if (input.state.status === "limited") {
    throw new WorkspaceAiQuotaLimitError(input.tier, input.limit);
  }
  if (
    input.state.status !== "allowed" ||
    input.state.count === null ||
    input.state.remaining === null
  ) {
    throw new WorkspaceAiQuotaUnavailableError();
  }
  return {
    tier: input.tier,
    identity: input.identity,
    account: input.account,
    limit: input.limit,
    used: input.state.count,
    remaining: input.state.remaining,
    reset: "daily-utc",
    cookies: input.cookies,
  };
}

async function reserveMemberQuota(
  account: StudioAccount,
  dependencies: WorkspaceAiQuotaDependencies,
  purpose: WorkspaceQuotaPurpose,
): Promise<WorkspaceAiQuotaReservation> {
  const env = dependencies.env ?? process.env;
  if (
    purpose === "generation"
      ? !platformAiReadiness("member", env).available
      : !resolveAccountCookieSecret(env) || !durableQuotaReady(env)
  ) {
    throw new WorkspaceAiQuotaUnavailableError(
      purpose === "generation"
        ? "Signed-in platform AI is not fully configured."
        : "Signed-in funded execution quota is not fully configured.",
    );
  }

  let tier: "member" | "pro" = "member";
  let limit = MEMBER_DAILY_LIMIT;
  const expectedPrice = stripeProPriceId(env);
  const storageConfigured =
    dependencies.billingStorageConfigured ?? billingStorageConfigured;
  const readBilling = dependencies.readBillingAccount ?? readBillingAccount;
  if (expectedPrice && storageConfigured()) {
    try {
      const billing = await readBilling(account.identity);
      const now = (dependencies.now ?? (() => new Date()))();
      tier = billingTierForAccount(billing, expectedPrice, now);
      limit = memberPlatformBuildLimit(billing, expectedPrice, now);
    } catch {
      // Billing reads fail closed to the signed member entitlement.
    }
  }

  const consumeQuota = dependencies.consumeQuota ?? consumeRequestLimitState;
  const state = await consumeQuota({
    identity: account.identity,
    namespace: purpose === "generation"
      ? "member-ai-plan"
      : "member-sandbox-execution",
    max: limit,
    windowMs: DAILY_WINDOW_MS,
  }).catch(() => ({
    status: "unavailable" as const,
    count: null,
    remaining: null,
  }));
  const secret = resolveAccountCookieSecret(env);
  const cookies: WorkspaceAiQuotaCookie[] = [];
  if (purpose === "generation" && secret && state.count !== null) {
    cookies.push({
      name: MEMBER_USAGE_COOKIE,
      value: createGuestUsageCookie(
        {
          date: dateUtc((dependencies.now ?? (() => new Date()))()),
          count: state.count,
          identity: account.identity,
        },
        secret,
      ),
      maxAge: 60 * 60 * 36,
    });
  }
  return reservationFromState({
    state,
    tier,
    identity: account.identity,
    account,
    limit,
    cookies,
  });
}

async function reserveGuestQuota(
  request: NextRequest,
  dependencies: WorkspaceAiQuotaDependencies,
  purpose: WorkspaceQuotaPurpose,
): Promise<WorkspaceAiQuotaReservation> {
  const env = dependencies.env ?? process.env;
  const now = (dependencies.now ?? (() => new Date()))();
  const context = resolveGuestAccess({
    identityCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
    usageCookie: request.cookies.get(GUEST_USAGE_COOKIE)?.value,
    date: dateUtc(now),
    env,
    createIdentity: dependencies.createGuestIdentity,
  });
  if (
    !context.configured ||
    !context.identity ||
    (purpose === "generation"
      ? !platformAiReadiness("guest", env).available
      : !durableQuotaReady(env))
  ) {
    throw new WorkspaceAiQuotaUnavailableError(
      purpose === "generation"
        ? "Guest platform AI is not fully configured."
        : "Guest funded execution quota is not fully configured.",
    );
  }

  const consumeQuota = dependencies.consumeQuota ?? consumeRequestLimitState;
  const state = await consumeQuota({
    identity: context.identity,
    namespace: purpose === "generation"
      ? "guest-ai-plan"
      : "guest-sandbox-execution",
    max: GUEST_DAILY_LIMIT,
    windowMs: DAILY_WINDOW_MS,
  }).catch(() => ({
    status: "unavailable" as const,
    count: null,
    remaining: null,
  }));
  const cookies: WorkspaceAiQuotaCookie[] = [];
  if (context.identityCookie) {
    cookies.push({
      name: GUEST_IDENTITY_COOKIE,
      value: context.identityCookie,
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  if (purpose === "generation" && state.count !== null) {
    cookies.push({
      name: GUEST_USAGE_COOKIE,
      value: createGuestUsageCookie(
        {
          date: dateUtc(now),
          count: state.count,
          identity: context.identity,
        },
        context.secret,
      ),
      maxAge: 60 * 60 * 36,
    });
  }
  return reservationFromState({
    state,
    tier: "guest",
    identity: context.identity,
    account: null,
    limit: GUEST_DAILY_LIMIT,
    cookies,
  });
}

export async function reserveWorkspacePlatformQuota(
  request: NextRequest,
  dependencies: WorkspaceAiQuotaDependencies = {},
): Promise<WorkspaceAiQuotaReservation> {
  const env = dependencies.env ?? process.env;
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    env,
  );
  return account
    ? reserveMemberQuota(account, dependencies, "generation")
    : reserveGuestQuota(request, dependencies, "generation");
}

/**
 * Vercel Sandbox runs have their own tier-derived daily counter. Keeping this
 * namespace separate from AI generation prevents one generate-then-run flow
 * from being charged twice against the model allowance while still bounding
 * the independently funded execution resource.
 */
export async function reserveWorkspaceExecutionQuota(
  request: NextRequest,
  dependencies: WorkspaceAiQuotaDependencies = {},
): Promise<WorkspaceAiQuotaReservation> {
  const env = dependencies.env ?? process.env;
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    env,
  );
  const reservation = account
    ? await reserveMemberQuota(account, dependencies, "execution")
    : await reserveGuestQuota(request, dependencies, "execution");
  return {
    ...reservation,
    // Preserve a newly minted signed guest identity, but never overwrite the
    // generation usage cookie with the independent execution count.
    cookies: reservation.cookies.filter(
      (cookie) => cookie.name === GUEST_IDENTITY_COOKIE,
    ),
  };
}
