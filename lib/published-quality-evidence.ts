import { getProductReality, launchStatusFor } from "./product-reality.ts";
import type { PresetId } from "./presets.ts";
import type {
  ProjectQualityCheck,
  ProjectQualityReport,
  ProjectRuntimeSmokeResult,
} from "./project-types.ts";

export const PUBLISHED_QUALITY_MAX_AGE_MS = 5 * 60 * 1_000;
export const PUBLISHED_QUALITY_MAX_FUTURE_SKEW_MS = 30 * 1_000;

function recentTimestamp(value: unknown, now: number): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp)
    && timestamp >= now - PUBLISHED_QUALITY_MAX_AGE_MS
    && timestamp <= now + PUBLISHED_QUALITY_MAX_FUTURE_SKEW_MS
  );
}

function qualityCheck(value: unknown): value is ProjectQualityCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.id === "string"
    && typeof input.label === "string"
    && typeof input.passed === "boolean"
    && typeof input.detail === "string"
    && typeof input.weight === "number"
    && Number.isFinite(input.weight)
    && typeof input.critical === "boolean"
  );
}

function serverInspection(
  value: unknown,
  now: number,
): value is ProjectRuntimeSmokeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    input.mode === "server-inspection"
    && input.executed === false
    && typeof input.runtime === "boolean"
    && typeof input.interactions === "boolean"
    && typeof input.dropstab === "boolean"
    && typeof input.dropsbot === "boolean"
    && typeof input.actions === "boolean"
    && (input.dataProvider === "dropstab"
      || input.dataProvider === "fallback"
      || input.dataProvider === "unverified")
    && Array.isArray(input.errors)
    && input.errors.every((error) => typeof error === "string")
    && recentTimestamp(input.checkedAt, now)
  );
}

/** Accepts only the authoritative inspection returned for this publish call. */
export function acceptPublishedQuality(
  value: unknown,
  presetId: PresetId,
  now = Date.now(),
): ProjectQualityReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const reality = getProductReality(presetId);
  if (
    !Number.isSafeInteger(input.score)
    || Number(input.score) < 0
    || Number(input.score) > 100
    || input.readyToPublish !== true
    || input.launchStatus !== launchStatusFor(presetId)
    || input.deliveryMode !== reality.deliveryMode
    || input.externalSetupRequired !== reality.externalSetupRequired
    || !Number.isFinite(now)
    || !recentTimestamp(input.checkedAt, now)
    || !Array.isArray(input.checks)
    || input.checks.length < 1
    || !input.checks.every(qualityCheck)
    || !Array.isArray(input.criticalFailures)
    || input.criticalFailures.length !== 0
    || input.checks.some(
      (check) => qualityCheck(check) && check.critical && !check.passed,
    )
    || !serverInspection(input.runtimeSmoke, now)
  ) {
    return null;
  }
  return input as unknown as ProjectQualityReport;
}
