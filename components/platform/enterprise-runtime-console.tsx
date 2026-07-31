"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Fingerprint,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { StatusBadge, type PlatformStatus } from "@/components/platform/platform-ui";

type CapabilityState = "working" | "working-local-test" | "setup-required" | "unavailable";
type RuntimeCheckState = "loading" | "working" | "local" | "setup" | "unavailable" | "error";

type RuntimeCheck = {
  id: "collaboration" | "identity";
  capabilityId: "collaboration" | "enterprise-identity";
  label: string;
  summary: string;
  publicReceipt?: string;
  configuration: string[];
};

type RuntimeReceipt = {
  state: RuntimeCheckState;
  detail: string;
  checkedAt: string | null;
  httpStatus: number | null;
  configuration: string[];
};

type CapabilityReceipt = {
  id: string;
  state: CapabilityState;
  detail: string;
  requiredEnvironment: string[];
};

const checks: RuntimeCheck[] = [
  {
    id: "collaboration",
    capabilityId: "collaboration",
    label: "Realtime collaboration",
    summary: "Reads the server-approved transport receipt used for presence and shared editing.",
    configuration: ["DROPS_COLLABORATION_TRANSPORT_URL"],
  },
  {
    id: "identity",
    capabilityId: "enterprise-identity",
    label: "Enterprise OIDC",
    summary: "Reads the server-approved identity receipt before enterprise sign-in is offered.",
    publicReceipt: "/api/enterprise/oidc/.well-known/openid-configuration",
    configuration: [
      "DROPS_ENTERPRISE_OIDC_ISSUER",
      "DROPS_ENTERPRISE_OIDC_CLIENT_ID",
      "DROPS_ENTERPRISE_OIDC_CLIENT_SECRET",
      "DROPS_ENTERPRISE_OIDC_REDIRECT_URIS",
      "DROPS_ENTERPRISE_OIDC_SIGNING_SECRET",
      "DROPS_ENTERPRISE_OIDC_SUBJECT_SALT",
    ],
  },
];

const initialReceipt: RuntimeReceipt = {
  state: "loading",
  detail: "Waiting for the capability snapshot.",
  checkedAt: null,
  httpStatus: null,
  configuration: [],
};

function cleanDetail(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.slice(0, 240);
}

function isCapabilityState(value: unknown): value is CapabilityState {
  return value === "working"
    || value === "working-local-test"
    || value === "setup-required"
    || value === "unavailable";
}

function isCapabilityReceipt(value: unknown): value is CapabilityReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.id === "string"
    && isCapabilityState(receipt.state)
    && typeof receipt.detail === "string"
    && Array.isArray(receipt.requiredEnvironment)
    && receipt.requiredEnvironment.every((name) => typeof name === "string");
}

function stateFromCapability(state: CapabilityState): RuntimeCheckState {
  if (state === "working") return "working";
  if (state === "working-local-test") return "local";
  if (state === "setup-required") return "setup";
  return "unavailable";
}

function errorReceipts(
  detail: string,
  checkedAt: string,
  httpStatus: number | null,
): Record<RuntimeCheck["id"], RuntimeReceipt> {
  return Object.fromEntries(checks.map((check) => [check.id, {
    state: "error",
    detail,
    checkedAt,
    httpStatus,
    configuration: check.configuration,
  }])) as Record<RuntimeCheck["id"], RuntimeReceipt>;
}

async function readCapabilityReceipts(): Promise<Record<RuntimeCheck["id"], RuntimeReceipt>> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch("/api/platform/capabilities", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !payload || !Array.isArray(payload.capabilities)) {
      return errorReceipts("The capability snapshot is unavailable.", checkedAt, response.status);
    }

    const capabilities = payload.capabilities.filter(isCapabilityReceipt);
    const snapshotTime = typeof payload.healthCheckedAt === "string"
      && Number.isFinite(Date.parse(payload.healthCheckedAt))
      ? payload.healthCheckedAt
      : null;

    return Object.fromEntries(checks.map((check) => {
      const capability = capabilities.find((candidate) => candidate.id === check.capabilityId);
      if (!capability) {
        return [check.id, {
          state: "error",
          detail: "The capability snapshot did not include this provider receipt.",
          checkedAt: snapshotTime,
          httpStatus: response.status,
          configuration: check.configuration,
        } satisfies RuntimeReceipt] as const;
      }

      return [check.id, {
        state: stateFromCapability(capability.state),
        detail: cleanDetail(capability.detail, "No provider detail was returned."),
        checkedAt: snapshotTime,
        httpStatus: response.status,
        configuration: capability.requiredEnvironment,
      } satisfies RuntimeReceipt] as const;
    })) as Record<RuntimeCheck["id"], RuntimeReceipt>;
  } catch (cause) {
    const detail = cause instanceof DOMException && cause.name === "AbortError"
      ? "The capability snapshot timed out after 10 seconds."
      : "The capability snapshot could not be reached.";
    return errorReceipts(detail, checkedAt, null);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function statusFor(state: RuntimeCheckState): PlatformStatus {
  if (state === "working") return "working";
  if (state === "local") return "local";
  if (state === "setup") return "setup";
  if (state === "unavailable" || state === "error") return "feature-gated";
  return "configured";
}

function labelFor(state: RuntimeCheckState): string {
  if (state === "working") return "Working";
  if (state === "local") return "Core verified locally";
  if (state === "setup") return "Setup required";
  if (state === "unavailable") return "Health evidence required";
  if (state === "error") return "Check unavailable";
  return "Checking";
}

function RuntimeReceiptCard({ check, receipt }: { check: RuntimeCheck; receipt: RuntimeReceipt }) {
  const Icon = check.id === "collaboration" ? RadioTower : Fingerprint;
  const EvidenceIcon = receipt.state === "working" ? ShieldCheck : receipt.state === "loading" ? LoaderCircle : ShieldAlert;

  return (
    <article className="min-w-0 rounded-2xl border border-[#dbe4f1] bg-[#f8fbff] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[#245fe5] shadow-[0_8px_24px_rgba(49,84,144,0.07)]">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-[#07142f]">{check.label}</h3>
            <p className="mt-1 text-sm leading-6 text-[#52617a]">{check.summary}</p>
          </div>
        </div>
        <StatusBadge status={statusFor(receipt.state)}>{labelFor(receipt.state)}</StatusBadge>
      </div>

      <div
        className="mt-5 rounded-xl border border-[#dbe4f1] bg-white p-4"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-start gap-3">
          <EvidenceIcon
            className={`mt-0.5 size-5 shrink-0 ${receipt.state === "working" ? "text-[#139a62]" : receipt.state === "setup" ? "text-[#ad6b0a]" : "text-[#596980]"} ${receipt.state === "loading" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#07142f]">{labelFor(receipt.state)}</p>
            <p className="mt-1 text-sm leading-6 text-[#52617a]">{receipt.detail}</p>
            <p className="mt-2 font-mono text-xs text-[#71809a]">
              {receipt.checkedAt
                ? `Provider health ${new Date(receipt.checkedAt).toLocaleString()}${receipt.httpStatus ? ` · HTTP ${receipt.httpStatus}` : ""}`
                : "No current provider health receipt"}
            </p>
          </div>
        </div>
      </div>

      {receipt.state !== "working" && receipt.configuration.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-[#596980]">Required server configuration</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {receipt.configuration.map((name) => (
              <code key={name} className="max-w-full break-all rounded-lg border border-[#dbe4f1] bg-white px-2.5 py-1.5 text-xs text-[#52617a]">
                {name}
              </code>
            ))}
          </div>
        </div>
      ) : null}

      {check.publicReceipt ? (
        <div className="mt-5 border-t border-[#dbe4f1] pt-4">
          <a
            href={check.publicReceipt}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[#245fe5] no-underline transition-colors hover:bg-[#eef4ff] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30"
          >
            Open public OIDC discovery
            <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
          </a>
          <p className="mt-2 break-all font-mono text-xs text-[#71809a]">{check.publicReceipt}</p>
        </div>
      ) : (
        <p className="mt-5 border-t border-[#dbe4f1] pt-4 text-sm leading-6 text-[#52617a]">
          Transport health stays operator-protected and is surfaced here only through the capability snapshot.
        </p>
      )}
    </article>
  );
}

export function EnterpriseRuntimeConsole() {
  const [receipts, setReceipts] = useState<Record<RuntimeCheck["id"], RuntimeReceipt>>({
    collaboration: initialReceipt,
    identity: initialReceipt,
  });
  const [refreshing, setRefreshing] = useState(true);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    setRefreshing(true);
    setReceipts({ collaboration: initialReceipt, identity: initialReceipt });
    try {
      const nextReceipts = await readCapabilityReceipts();
      if (refreshGeneration.current !== generation) return;
      setReceipts(nextReceipts);
    } finally {
      if (refreshGeneration.current === generation) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      refreshGeneration.current += 1;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-8 sm:px-6 lg:px-8" aria-labelledby="enterprise-runtime-title">
      <div className="rounded-3xl border border-[#cfdcff] bg-white p-5 shadow-[0_18px_54px_rgba(49,84,144,0.075)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#245fe5]">Runtime evidence</p>
            <h2 id="enterprise-runtime-title" className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#07142f]">
              Realtime and identity provider checks
            </h2>
            <p className="mt-2 text-base leading-7 text-[#52617a]">
              Both statuses come from one public capability snapshot. Operator-only health checks remain server-side, and credential values never leave the server.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#b9ccff] bg-white px-4 text-sm font-semibold text-[#173f9f] transition-colors hover:bg-[#eef4ff] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "Checking providers" : "Refresh capability snapshot"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {checks.map((check) => (
            <RuntimeReceiptCard key={check.id} check={check} receipt={receipts[check.id]} />
          ))}
        </div>
      </div>
    </section>
  );
}
