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

test("publish readiness requires a successful executed runtime smoke", () => {
  const pending = evaluateProjectQuality(spec, html);
  assert.equal(pending.readyToPublish, false);
  assert.ok(pending.criticalFailures.includes("runtime"));

  const smoke = {
    executed: true,
    runtime: true,
    interactions: true,
    dropstab: true,
    dropsbot: true,
    actions: true,
    errors: [],
    checkedAt: new Date().toISOString(),
  };
  const passed = evaluateProjectQuality(spec, html, smoke);
  assert.equal(passed.readyToPublish, true);
  assert.equal(passed.score, 100);
  assert.equal(passed.launchStatus, "external-setup-required");
});

test("a runtime error blocks publishing even when static markers pass", () => {
  const failed = evaluateProjectQuality(spec, html, {
    executed: true,
    runtime: true,
    interactions: true,
    dropstab: true,
    dropsbot: true,
    actions: true,
    errors: ["Unhandled runtime exception"],
    checkedAt: new Date().toISOString(),
  });
  assert.equal(failed.readyToPublish, false);
  assert.ok(failed.criticalFailures.includes("runtime"));
});
