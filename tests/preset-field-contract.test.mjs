import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runContractProbe() {
  const source = String.raw`
    import { compileProject } from "./lib/project-compiler.ts";
    import { applyPresetFieldValue, createProjectSpec, gameRoundSeconds } from "./lib/project-factory.ts";
    import { customProductPreset, presets } from "./lib/presets.ts";

    const market = [
      { symbol: "BTC", name: "Bitcoin", price: "$118,420", change: 2.4, marketCap: "$2.36T" },
      { symbol: "ETH", name: "Ethereum", price: "$3,780", change: -1.2, marketCap: "$456B" },
      { symbol: "SOL", name: "Solana", price: "$198", change: 8.6, marketCap: "$99B" },
    ];
    const prediction = { title: "Bitcoin above $120k", probability: 64, change: 3 };
    const contracts = [];
    const nativeDirections = [];
    const restoredDirections = [];

    for (const preset of [...presets, customProductPreset]) {
      const values = Object.fromEntries(
        preset.fields.map((field) => [field.id, field.options.at(-1) ?? field.value]),
      );
      const initial = createProjectSpec({
        presetId: preset.id,
        values: Object.fromEntries(preset.fields.map((field) => [field.id, field.value])),
        prompt: preset.shortTitle + " field contract",
        tools: preset.tools,
        provider: "free",
        model: "Free Auto",
        market,
        prediction,
        origin: "https://studio.example",
      });
      const spec = Object.entries(values).reduce(
        (current, [fieldId, value]) => applyPresetFieldValue(current, fieldId, value),
        initial,
      );
      const html = compileProject(spec);
      contracts.push({
        id: preset.id,
        fieldCount: preset.fields.length,
        valuesPreserved: preset.fields.every((field) => spec.values[field.id] === values[field.id]),
        fieldsCompiled: preset.fields.every(
          (field) => html.includes('\"id\":\"' + field.id + '\"') && html.includes(String(values[field.id])),
        ),
        time: spec.values.time ?? null,
        schedule: spec.values.schedule ?? null,
      });
      nativeDirections.push({
        id: preset.id,
        layout: spec.experience.layout,
        dataView: spec.experience.dataView,
        engagement: spec.experience.engagement,
        audience: spec.experience.audience,
      });
      const restored = preset.fields.reduce((current, field) => {
        const changed = applyPresetFieldValue(current, field.id, field.options.at(-1) ?? field.value);
        return applyPresetFieldValue(changed, field.id, field.value);
      }, initial);
      restoredDirections.push({
        id: preset.id,
        layout: restored.experience.layout,
        dataView: restored.experience.dataView,
        engagement: restored.experience.engagement,
        audience: restored.experience.audience,
      });
    }

    const gamePreset = presets.find((preset) => preset.id === "crypto-game");
    const baseGameValues = Object.fromEntries(
      gamePreset.fields.map((field) => [field.id, field.value]),
    );
    const games = Object.fromEntries(
      [
        ["Beat the Market", "market-race"],
        ["Guess the Coin", "coin-quiz"],
        ["Portfolio Battle", "portfolio-battle"],
        ["Unlock Dodge", "unlock-dodge"],
      ].map(([option, expected]) => {
        const spec = createProjectSpec({
          presetId: "crypto-game",
          values: { ...baseGameValues, game: option },
          prompt: option,
          tools: gamePreset.tools,
          provider: "free",
          model: "Free Auto",
          market,
          prediction,
          origin: "https://studio.example",
        });
        return [option, { actual: spec.gameDirection?.genre, expected }];
      }),
    );
    const editableGame = createProjectSpec({
      presetId: "crypto-game",
      values: baseGameValues,
      prompt: "Editable game",
      tools: gamePreset.tools,
      provider: "free",
      model: "Free Auto",
      market,
      prediction,
      origin: "https://studio.example",
    });
    const editedGame = applyPresetFieldValue(
      applyPresetFieldValue(
        applyPresetFieldValue(editableGame, "game", "Portfolio Battle"),
        "round",
        "7 days",
      ),
      "social",
      "No leaderboard",
    );

    console.log(JSON.stringify({
      presetCount: presets.length,
      fieldCount: presets.reduce((total, preset) => total + preset.fields.length, 0),
      contracts,
      nativeDirections,
      restoredDirections,
      games,
      roundSeconds: ["5 minutes", "1 hour", "24 hours", "7 days"].map(gameRoundSeconds),
      nearMissRoundSeconds: ["15 minutes", "21 hours", "17 days"].map(gameRoundSeconds),
      defaultGame: gamePreset.fields.find((field) => field.id === "game")?.value,
      editedGame: {
        genre: editedGame.gameDirection?.genre,
        roundSeconds: editedGame.gameDirection?.roundSeconds,
        engagement: editedGame.experience.engagement,
      },
    }));
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test("all 48 preset fields survive validation and compile into the runtime contract", () => {
  const probe = runContractProbe();
  assert.equal(probe.presetCount, 12);
  assert.equal(probe.fieldCount, 48);
  assert.equal(probe.contracts.length, 13);
  for (const contract of probe.contracts) {
    assert.equal(contract.fieldCount, 4, `${contract.id} must keep four editable preset fields`);
    assert.equal(contract.valuesPreserved, true, `${contract.id} values were stripped during validation`);
    assert.equal(contract.fieldsCompiled, true, `${contract.id} values did not reach compiled HTML`);
  }
  const morning = probe.contracts.find((contract) => contract.id === "morning-alpha");
  assert.equal(morning.time, "After I wake up");
  assert.equal(morning.schedule, null);
});

test("category settings alter native experience direction for all presets and blank canvas", () => {
  const probe = runContractProbe();
  const directions = Object.fromEntries(
    probe.nativeDirections.map((direction) => [direction.id, direction]),
  );

  assert.deepEqual(directions["action-engine"], {
    id: "action-engine",
    layout: "split",
    dataView: "cards",
    engagement: "realtime",
    audience: "Custom thesis operators",
  });
  assert.deepEqual(directions["alpha-channel"], {
    id: "alpha-channel",
    layout: "feed",
    dataView: "mixed",
    engagement: "social",
    audience: "Polymarket alpha Telegram creators",
  });
  assert.deepEqual(directions["morning-alpha"], {
    id: "morning-alpha",
    layout: "focus",
    dataView: "mixed",
    engagement: "scheduled",
    audience: "Custom watchlist daily readers",
  });
  assert.deepEqual(directions["prediction-impact"], {
    id: "prediction-impact",
    layout: "focus",
    dataView: "cards",
    engagement: "realtime",
    audience: "Event-driven traders",
  });
  assert.deepEqual(directions["smart-money-copy"], {
    id: "smart-money-copy",
    layout: "dashboard",
    dataView: "timeline",
    engagement: "personal",
    audience: "My public list strategy operators",
  });
  assert.deepEqual(directions["crypto-aggregator"], {
    id: "crypto-aggregator",
    layout: "dashboard",
    dataView: "mixed",
    engagement: "social",
    audience: "My custom list market explorers",
  });
  assert.deepEqual(directions["crypto-game"], {
    id: "crypto-game",
    layout: "spatial",
    dataView: "graph",
    engagement: "personal",
    audience: "My watchlist game players",
  });
  assert.deepEqual(directions["personal-companion"], {
    id: "personal-companion",
    layout: "feed",
    dataView: "timeline",
    engagement: "personal",
    audience: "Research analyst crypto explorers",
  });
  assert.deepEqual(directions["portfolio-tamagotchi"], {
    id: "portfolio-tamagotchi",
    layout: "split",
    dataView: "cards",
    engagement: "realtime",
    audience: "Risk therapist portfolio holders",
  });
  assert.deepEqual(directions["crypto-product-hunt"], {
    id: "crypto-product-hunt",
    layout: "feed",
    dataView: "cards",
    engagement: "personal",
    audience: "AI x crypto product builders",
  });
  assert.deepEqual(directions["crypto-radio"], {
    id: "crypto-radio",
    layout: "split",
    dataView: "timeline",
    engagement: "social",
    audience: "Degen drive time listeners",
  });
  assert.deepEqual(directions["crypto-siri"], {
    id: "crypto-siri",
    layout: "focus",
    dataView: "mixed",
    engagement: "realtime",
    audience: "Auto detect voice users",
  });
  assert.deepEqual(directions["custom-product"], {
    id: "custom-product",
    layout: "dashboard",
    dataView: "cards",
    engagement: "personal",
    audience: "My community",
  });
});

test("switching every dropdown back to its default restores deterministic native direction", () => {
  const probe = runContractProbe();
  const restored = Object.fromEntries(
    probe.restoredDirections.map((direction) => [direction.id, direction]),
  );
  assert.deepEqual(restored, {
    "action-engine": { id: "action-engine", layout: "split", dataView: "graph", engagement: "realtime", audience: "Active crypto operators" },
    "alpha-channel": { id: "alpha-channel", layout: "feed", dataView: "timeline", engagement: "social", audience: "Solana smart money Telegram creators" },
    "morning-alpha": { id: "morning-alpha", layout: "focus", dataView: "cards", engagement: "scheduled", audience: "BTC, ETH, SOL daily readers" },
    "prediction-impact": { id: "prediction-impact", layout: "split", dataView: "map", engagement: "realtime", audience: "Event-driven traders" },
    "smart-money-copy": { id: "smart-money-copy", layout: "dashboard", dataView: "timeline", engagement: "realtime", audience: "Add addresses strategy operators" },
    "crypto-aggregator": { id: "crypto-aggregator", layout: "dashboard", dataView: "table", engagement: "realtime", audience: "Top 100 coins market explorers" },
    "crypto-game": { id: "crypto-game", layout: "spatial", dataView: "graph", engagement: "social", audience: "Top 20 game players" },
    "personal-companion": { id: "personal-companion", layout: "feed", dataView: "cards", engagement: "personal", audience: "Balanced explorer crypto explorers" },
    "portfolio-tamagotchi": { id: "portfolio-tamagotchi", layout: "split", dataView: "cards", engagement: "scheduled", audience: "Calm quant portfolio holders" },
    "crypto-product-hunt": { id: "crypto-product-hunt", layout: "feed", dataView: "cards", engagement: "social", audience: "New crypto products product builders" },
    "crypto-radio": { id: "crypto-radio", layout: "split", dataView: "timeline", engagement: "scheduled", audience: "Market in 5 listeners" },
    "crypto-siri": { id: "crypto-siri", layout: "focus", dataView: "cards", engagement: "realtime", audience: "English + Russian voice users" },
    "custom-product": { id: "custom-product", layout: "dashboard", dataView: "mixed", engagement: "realtime", audience: "Crypto operators" },
  });
});

test("four game presets map to distinct runtimes and the illustrated game is default", () => {
  const probe = runContractProbe();
  for (const [option, contract] of Object.entries(probe.games)) {
    assert.equal(contract.actual, contract.expected, `${option} mapped to the wrong game runtime`);
  }
  assert.deepEqual(probe.roundSeconds, [15, 20, 30, 45]);
  assert.deepEqual(probe.nearMissRoundSeconds, [30, 30, 30]);
  assert.equal(probe.defaultGame, "Unlock Dodge");
  assert.deepEqual(probe.editedGame, {
    genre: "portfolio-battle",
    roundSeconds: 45,
    engagement: "personal",
  });
});
