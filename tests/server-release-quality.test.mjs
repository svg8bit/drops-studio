import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateServerReleaseQuality,
  stampProviderEvidence,
} from "../lib/server-release-quality.ts";

function gameSpec() {
  return {
    schemaVersion: 1,
    presetId: "crypto-game",
    name: "Market Catcher",
    slug: "market-catcher",
    tagline: "Playable market arcade",
    description: "A local-first game powered by an attributable market adapter.",
    prompt: "Build a playable market catcher game",
    tools: ["DropsTab market data", "Drops Bot action handoff"],
    values: { game: "Market Catcher" },
    brain: { provider: "free", model: "Free Auto", enhanced: false },
    theme: { accent: "#2563eb", surface: "#071326", mode: "dark", style: "playful" },
    design: { kit: "mascot-pop", density: "cinematic", motion: "smooth", radius: 18, font: "inter" },
    blocks: {},
    experience: {
      archetype: "game-world",
      layout: "spatial",
      dataView: "cards",
      engagement: "personal",
      audience: "crypto players",
      primaryLoop: "Play a local round",
      modules: ["Scene", "Round", "Score", "Research"],
      assetSource: "free-vector",
    },
    blueprint: {
      locale: "en",
      productType: "Playable crypto game",
      visualConcept: "Illustrated market catcher",
      primaryLoop: "Catch tokens and dodge risks",
      modules: ["Scene", "Round", "Score", "Research"],
      screens: ["Game", "Result", "Settings"],
      interactions: ["Start", "Move left", "Move right", "Research"],
      dropsTabUse: ["Market snapshot", "Asset research"],
      dropsBotUse: ["Approved alert handoff"],
      acceptanceChecks: ["Playable locally"],
      content: { headline: "Catch the market", subheadline: "Local arcade", primaryAction: "Start", emptyState: "Start a round" },
      game: { mechanic: "catcher", protagonist: "wolf", scene: "market", objective: "score", artDirection: "cartoon", dataUse: "snapshot" },
    },
    gameDirection: {
      genre: "catcher",
      artStyle: "retro-cartoon",
      world: "retro-factory",
      mascot: "retro-wolf",
      gameLoop: "catch and dodge",
      mechanic: "catcher",
      protagonist: "wolf",
      scene: "market",
      objective: "score",
      artDirection: "cartoon",
      dataUse: "snapshot",
      difficulty: "normal",
      roundSeconds: 30,
      sound: false,
      assetSource: "free-vector",
    },
    market: [{ symbol: "BTC", name: "Bitcoin", price: "$100", change: 2, marketCap: "$2T" }],
    prediction: { title: "BTC up", probability: 60, change: 2 },
    dataEndpoint: "/api/public-data",
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

function gameHtml() {
  return `${" ".repeat(19_000)}<!doctype html><html data-project-kind="crypto-game" data-delivery-mode="web-native"><head><title>Market Catcher</title><meta name="viewport"></head><body data-studio-block="application"><section class="catcher-runtime"><button data-action="play-catcher">Play</button><button data-action="dropsbot-setup">Connect Drops Bot</button></section><p>Human approval required. Nothing was executed.</p><script>function refreshData(){} function dropsbotSetup(){} function save(){localStorage.setItem("score","1")} document.addEventListener("click",function(){})</script><style>@media(max-width:760px){}</style></body></html>`;
}

test("server release gate accepts inspected contracts without claiming code execution", () => {
  const spec = gameSpec();
  const report = evaluateServerReleaseQuality(spec, gameHtml(), "unverified");
  assert.equal(report.readyToPublish, true);
  assert.equal(report.runtimeSmoke?.mode, "server-inspection");
  assert.equal(report.runtimeSmoke?.executed, false);
  assert.equal(report.runtimeSmoke?.dataProvider, "unverified");
  assert.equal(report.checks.find((item) => item.id === "provider-evidence")?.passed, false);
  assert.equal(report.checks.find((item) => item.id === "data-adapter")?.passed, true);
  assert.doesNotMatch(
    report.checks.map((item) => item.detail).join("\n"),
    /executed inside the sandbox|live controls verified|executed runtime/i,
  );
  assert.match(
    report.checks.find((item) => item.id === "runtime")?.detail ?? "",
    /static server inspection|syntax|contract/i,
  );
});

test("server release gate fails closed on broken JavaScript or the wrong category runtime", () => {
  const spec = gameSpec();
  const html = gameHtml();
  const invalidScript = evaluateServerReleaseQuality(spec, html.replace("function refreshData(){}", "function refreshData({"), "fallback");
  assert.equal(invalidScript.readyToPublish, false);
  assert.ok(invalidScript.criticalFailures.includes("runtime"));

  const wrongRuntime = evaluateServerReleaseQuality(
    spec,
    html.replaceAll("catcher-runtime", "generic-panel").replaceAll("play-catcher", "generic-action"),
    "dropstab",
  );
  assert.equal(wrongRuntime.readyToPublish, false);
  assert.ok(wrongRuntime.criticalFailures.includes("runtime"));
});

test("server-owned provider evidence replaces duplicates across quoted tag boundaries", () => {
  const html = gameHtml().replace(
    "<html ",
    '<html data-marker="keep>boundary" data-provider-evidence="dropstab" data-provider-evidence="fallback" ',
  );
  const stamped = stampProviderEvidence(html, "unverified");
  assert.match(stamped, /data-marker="keep>boundary"/);
  assert.match(stamped, /data-provider-evidence="unverified"/);
  assert.equal(stamped.match(/data-provider-evidence=/gi)?.length, 1);
  assert.doesNotMatch(stamped, /data-provider-evidence="(?:dropstab|fallback)"/);

  const booleanStamp = stampProviderEvidence(
    gameHtml().replace(
      "<html ",
      "<html data-provider-evidence lang=en ",
    ),
    "unverified",
  );
  assert.match(booleanStamp, /<html\s+lang=en\s+/);
  assert.equal(booleanStamp.match(/data-provider-evidence/gi)?.length, 1);
});
