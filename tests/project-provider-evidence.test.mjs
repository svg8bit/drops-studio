import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProjectQuality } from "../lib/project-quality.ts";

const spec = {
  presetId: "morning-alpha",
  experience: { archetype: "editorial-brief" },
  blueprint: {
    productType: "Telegram morning brief",
    visualConcept: "A Telegram daily brief",
    screens: ["Brief", "Watchlist", "Schedule"],
    modules: ["Cover", "Moves", "Unlocks", "Funding"],
    interactions: ["Refresh", "Open source", "Set alert", "Change watchlist"],
    dropsTabUse: ["Prices", "Unlocks"],
    dropsBotUse: ["Telegram delivery"],
  },
  blocks: {},
};
const html = `${"x".repeat(19_000)}<html data-project-kind="morning-alpha" data-delivery-mode="connection-required"><head><title>Brief</title><meta name="viewport"></head><body data-studio-block="application">approval required<script>function refreshData(){} function dropsbotSetup(){} function save(){localStorage.setItem("x","y")} document.addEventListener("click",()=>{})</script><style>@media(max-width:760px){}</style></body></html>`;
const smoke = (dataProvider) => ({
  mode: "browser",
  dataProvider,
  executed: true,
  runtime: true,
  interactions: true,
  dropstab: true,
  dropsbot: true,
  actions: true,
  errors: [],
  checkedAt: new Date().toISOString(),
});

test("fallback is runnable but cannot pass live DropsTab provider evidence", () => {
  const report = evaluateProjectQuality(spec, html, smoke("fallback"));
  assert.equal(report.readyToPublish, true);
  assert.equal(report.checks.find((item) => item.id === "data-adapter")?.passed, true);
  assert.equal(report.checks.find((item) => item.id === "provider-evidence")?.passed, false);
  assert.match(report.checks.find((item) => item.id === "provider-evidence")?.detail ?? "", /fallback/i);
});

test("only provider=dropstab passes the live provider evidence check", () => {
  for (const provider of ["test", "coinbase", "fallback", "unverified", ""] ) {
    const report = evaluateProjectQuality(spec, html, smoke(provider));
    assert.equal(report.checks.find((item) => item.id === "provider-evidence")?.passed, false, provider);
  }
  const verified = evaluateProjectQuality(spec, html, smoke("dropstab"));
  assert.equal(verified.checks.find((item) => item.id === "provider-evidence")?.passed, true);
});
