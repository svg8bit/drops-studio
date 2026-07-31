import { runPlatformProviderHealthChecks } from "../lib/platform-provider-health.ts";

const receipt = await runPlatformProviderHealthChecks({
  includeSandbox: process.env.DROPS_SKIP_SANDBOX_HEALTH !== "1",
  persist: true,
});

for (const [id, check] of Object.entries(receipt.checks)) {
  console.log(`${id}: ${check.status} (${check.mode})`);
}

const required = ["project-data", "managed-backend", "organizations"];
if (receipt.checks.sandbox) required.push("sandbox");

if (required.some(
  (id) => receipt.checks[id]?.status !== "working",
)) {
  process.exitCode = 1;
}
