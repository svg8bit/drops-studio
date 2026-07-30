import { randomUUID } from "node:crypto";
import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export type BillingTier = "guest" | "member" | "pro";
export type BillingSubscriptionStatus =
  | "none"
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "paused"
  | "trialing"
  | "unpaid";

export interface BillingAccountRecord {
  accountIdentity: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  priceId: string | null;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
}

export interface BillingWebhookEvent {
  id: string;
  type: string;
  mutation: "subscription" | "ignored";
  createdAt: string;
  accountIdentity: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  priceId: string | null;
  status: BillingSubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingEntitlements {
  tier: BillingTier;
  platformDailyBuilds: number;
  privateProjects: number;
  teamWorkspaces: number;
  collaboratorsPerWorkspace: number;
  byok: {
    available: true;
    sessionOnly: true;
    billingOwner: "user";
    markupBasisPoints: 0;
    providers: ["openrouter", "openai", "anthropic", "kimi", "custom"];
  };
}

const BYOK = {
  available: true,
  sessionOnly: true,
  billingOwner: "user",
  markupBasisPoints: 0,
  providers: ["openrouter", "openai", "anthropic", "kimi", "custom"],
} as const;

export const MEMBER_PRIVATE_PROJECT_LIMIT = 50;
export const PRO_PRIVATE_PROJECT_LIMIT = 500;

export function billingEntitlements(tier: BillingTier): BillingEntitlements {
  const limits = tier === "pro"
    ? {
        platformDailyBuilds: 100,
        privateProjects: PRO_PRIVATE_PROJECT_LIMIT,
        teamWorkspaces: 10,
        collaboratorsPerWorkspace: 25,
      }
    : tier === "member"
      ? {
          platformDailyBuilds: 10,
          privateProjects: MEMBER_PRIVATE_PROJECT_LIMIT,
          teamWorkspaces: 0,
          collaboratorsPerWorkspace: 0,
        }
      : {
          platformDailyBuilds: 3,
          privateProjects: 0,
          teamWorkspaces: 0,
          collaboratorsPerWorkspace: 0,
        };
  return { tier, ...limits, byok: { ...BYOK, providers: [...BYOK.providers] } };
}

export function billingTierForAccount(
  account: BillingAccountRecord | null,
  expectedPriceId: string | null,
  now = new Date(),
): "member" | "pro" {
  const currentPeriodEnd = account?.currentPeriodEnd
    ? Date.parse(account.currentPeriodEnd)
    : Number.NaN;
  return account
    && expectedPriceId !== null
    && validStripeId(expectedPriceId, "price")
    && account.priceId === expectedPriceId
    && (account.status === "active" || account.status === "trialing")
    && Number.isFinite(currentPeriodEnd)
    && currentPeriodEnd > now.getTime()
    ? "pro"
    : "member";
}

export function memberPlatformBuildLimit(
  account: BillingAccountRecord | null,
  expectedPriceId: string | null,
  now = new Date(),
): number {
  return billingEntitlements(
    billingTierForAccount(account, expectedPriceId, now),
  ).platformDailyBuilds;
}

export interface StripeBillingConfig {
  priceId: string;
  portalReturnPath: string;
}

export interface StripeBillingProvider {
  createCustomer(input: {
    accountIdentity: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createCheckoutSession(input: {
    accountIdentity: string;
    customerId: string;
    idempotencyKey: string;
    mode: "subscription";
    lineItems: [{ price: string; quantity: 1 }];
    successUrl: string;
    cancelUrl: string;
    allowPromotionCodes: false;
  }): Promise<{ id: string; url: string | null }>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ id: string; url: string }>;
}

export interface BillingRepository {
  readAccount(identity: string): Promise<BillingAccountRecord | null>;
  saveCustomer(
    identity: string,
    customerId: string,
  ): Promise<BillingAccountRecord>;
}

export class BillingUnavailableError extends Error {
  constructor(message = "Billing is not configured or unavailable.") {
    super(message);
    this.name = "BillingUnavailableError";
  }
}

export class BillingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingValidationError";
  }
}

function validIdentity(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validStripeId(value: string, prefix: string): boolean {
  return new RegExp(`^${prefix}_[A-Za-z0-9_]{6,255}$`).test(value);
}

function safeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new BillingValidationError("Billing requires a valid same-origin URL.");
  }
}

function safeReturnPath(value: string): string {
  if (!/^\/[A-Za-z0-9/_-]{0,120}$/.test(value) || value.startsWith("//")) {
    throw new BillingValidationError("Billing return path is invalid.");
  }
  return value;
}

export async function createProCheckout(
  input: {
    accountIdentity: string;
    origin: string;
    consent: boolean;
  },
  options: {
    config: StripeBillingConfig;
    repository: BillingRepository;
    provider: StripeBillingProvider;
  },
): Promise<{ sessionId: string; checkoutUrl: string }> {
  if (!validIdentity(input.accountIdentity)) {
    throw new BillingValidationError("A signed member account is required.");
  }
  if (input.consent !== true) {
    throw new BillingValidationError("Explicit consent is required before opening checkout.");
  }
  if (!validStripeId(options.config.priceId, "price")) {
    throw new BillingUnavailableError();
  }
  const origin = safeOrigin(input.origin);
  const returnPath = safeReturnPath(options.config.portalReturnPath);
  let account = await options.repository.readAccount(input.accountIdentity);
  if (
    account
    && account.priceId === options.config.priceId
    && (account.status === "active" || account.status === "trialing")
  ) {
    throw new BillingValidationError(
      "This account already has an active Pro subscription. Use the billing portal to manage it.",
    );
  }
  if (!account) {
    const customer = await options.provider.createCustomer({
      accountIdentity: input.accountIdentity,
      idempotencyKey: `drops-customer-${input.accountIdentity}`,
    });
    if (!validStripeId(customer.id, "cus")) {
      throw new BillingUnavailableError("Stripe returned an invalid customer receipt.");
    }
    account = await options.repository.saveCustomer(
      input.accountIdentity,
      customer.id,
    );
  }
  const session = await options.provider.createCheckoutSession({
    accountIdentity: input.accountIdentity,
    customerId: account.stripeCustomerId,
    // A checkout is a fresh, server-issued attempt. Reusing an account/Price
    // key forever can return a completed or expired Stripe Checkout Session.
    idempotencyKey: `drops-checkout-${randomUUID()}`,
    mode: "subscription",
    lineItems: [{ price: options.config.priceId, quantity: 1 }],
    successUrl: `${origin}${returnPath}?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}${returnPath}?billing=cancelled`,
    allowPromotionCodes: false,
  });
  if (!validStripeId(session.id, "cs") || !session.url) {
    throw new BillingUnavailableError("Stripe did not return a checkout receipt.");
  }
  const checkoutUrl = new URL(session.url);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
    throw new BillingUnavailableError("Stripe returned an invalid checkout URL.");
  }
  return { sessionId: session.id, checkoutUrl: checkoutUrl.href };
}

export async function createCustomerPortal(
  input: {
    accountIdentity: string;
    origin: string;
  },
  options: {
    config: StripeBillingConfig;
    repository: BillingRepository;
    provider: StripeBillingProvider;
  },
): Promise<{ sessionId: string; portalUrl: string }> {
  if (!validIdentity(input.accountIdentity)) {
    throw new BillingValidationError("A signed member account is required.");
  }
  const account = await options.repository.readAccount(input.accountIdentity);
  if (!account) {
    throw new BillingValidationError("No Stripe customer is linked to this account.");
  }
  const origin = safeOrigin(input.origin);
  const session = await options.provider.createPortalSession({
    customerId: account.stripeCustomerId,
    returnUrl: `${origin}${safeReturnPath(options.config.portalReturnPath)}`,
  });
  if (!/^bps_[A-Za-z0-9_]{6,255}$/.test(session.id)) {
    throw new BillingUnavailableError("Stripe returned an invalid portal receipt.");
  }
  const portalUrl = new URL(session.url);
  if (portalUrl.protocol !== "https:" || portalUrl.username || portalUrl.password) {
    throw new BillingUnavailableError("Stripe returned an invalid portal URL.");
  }
  return { sessionId: session.id, portalUrl: portalUrl.href };
}

export function stripeCheckoutConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): (StripeBillingConfig & { secretKey: string }) | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const priceId = env.STRIPE_PRO_PRICE_ID?.trim() ?? "";
  if (!secretKey.startsWith("sk_") || !validStripeId(priceId, "price")) return null;
  return {
    secretKey,
    priceId,
    portalReturnPath: "/studio",
  };
}

export function stripeProPriceId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const priceId = env.STRIPE_PRO_PRICE_ID?.trim() ?? "";
  return validStripeId(priceId, "price") ? priceId : null;
}

export function stripeWebhookConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): { webhookSecret: string } | null {
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  return webhookSecret.startsWith("whsec_") && webhookSecret.length >= 24
    ? { webhookSecret }
    : null;
}

export function stripeBillingProvider(secretKey: string): StripeBillingProvider {
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  return {
    async createCustomer(input) {
      const customer = await stripe.customers.create(
        {
          metadata: { drops_account_identity: input.accountIdentity },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: customer.id };
    },
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: input.mode,
          customer: input.customerId,
          client_reference_id: input.accountIdentity,
          line_items: input.lineItems,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          allow_promotion_codes: input.allowPromotionCodes,
          metadata: { drops_account_identity: input.accountIdentity },
          subscription_data: {
            metadata: { drops_account_identity: input.accountIdentity },
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: session.id, url: session.url };
    },
    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { id: session.id, url: session.url };
    },
  };
}

function stringId(value: unknown, prefix: string): string | null {
  if (typeof value === "string" && validStripeId(value, prefix)) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && validStripeId(id, prefix) ? id : null;
  }
  return null;
}

function subscriptionStatus(value: unknown): BillingSubscriptionStatus | null {
  return [
    "active",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "past_due",
    "paused",
    "trialing",
    "unpaid",
  ].includes(String(value))
    ? String(value) as BillingSubscriptionStatus
    : null;
}

function unixTimestamp(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toISOString()
    : null;
}

function normalizedStripeEvent(event: Stripe.Event): BillingWebhookEvent {
  const object = event.data.object as unknown as Record<string, unknown>;
  const metadata = object.metadata && typeof object.metadata === "object"
    ? object.metadata as Record<string, unknown>
    : {};
  const accountIdentity = typeof metadata.drops_account_identity === "string"
    && validIdentity(metadata.drops_account_identity)
    ? metadata.drops_account_identity
    : typeof object.client_reference_id === "string"
      && validIdentity(object.client_reference_id)
      ? object.client_reference_id
      : null;
  const items = object.items && typeof object.items === "object"
    ? object.items as { data?: unknown }
    : {};
  const firstItem = Array.isArray(items.data) && items.data[0]
    && typeof items.data[0] === "object"
    ? items.data[0] as Record<string, unknown>
    : {};
  const priceId = stringId(firstItem.price, "price");
  const subscriptionTypes = new Set([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
  ]);
  const mutation = subscriptionTypes.has(event.type)
    ? "subscription" as const
    : "ignored" as const;
  return {
    id: event.id,
    type: event.type,
    mutation,
    createdAt: new Date(event.created * 1_000).toISOString(),
    accountIdentity,
    stripeCustomerId: stringId(object.customer, "cus"),
    stripeSubscriptionId:
      stringId(object.id, "sub") ?? stringId(object.subscription, "sub"),
    priceId,
    status: mutation === "ignored"
      ? null
      : event.type === "customer.subscription.deleted"
      ? "canceled"
      : subscriptionStatus(object.status),
    currentPeriodEnd: mutation === "ignored"
      ? null
      : unixTimestamp(firstItem.current_period_end ?? object.current_period_end),
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
  };
}

export function verifyStripeWebhook(
  rawBody: Buffer | Uint8Array,
  signature: string,
  webhookSecret: string,
  receivedAt?: number,
): BillingWebhookEvent {
  if (!signature || !webhookSecret.startsWith("whsec_")) {
    throw new BillingValidationError("Stripe webhook signature is missing.");
  }
  try {
    const stripe = new Stripe("sk_test_signature_verification_only", {
      apiVersion: STRIPE_API_VERSION,
    });
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
      300,
      undefined,
      receivedAt,
    );
    return normalizedStripeEvent(event);
  } catch {
    throw new BillingValidationError("Stripe webhook signature verification failed.");
  }
}
