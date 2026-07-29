import assert from "node:assert/strict";
import test from "node:test";
import { routeProductIntent } from "../lib/product-intent.ts";

const cases = [
  ["Build a crypto Telegram alert channel with wallet tracking and editable alert rules", "alpha-channel"],
  ["Создай автоматизированный телеграм канал, который следит за кошельками китов", "alpha-channel"],
  ["Build a smart money copy trading strategy and send fills to Telegram", "smart-money-copy"],
  ["Хочу создать игру волк как в СССР на данных DropsTab", "crypto-game"],
  ["Build an AI crypto radio with a real player and daily show", "crypto-radio"],
  ["Create my own CoinMarketCap crypto aggregator", "crypto-aggregator"],
  ["Daily morning brief delivered in Telegram", "morning-alpha"],
  ["Map Polymarket odds changes to related tokens", "prediction-impact"],
];

test("output-first routing preserves the requested product category", () => {
  for (const [prompt, expected] of cases) {
    assert.equal(routeProductIntent(prompt).presetId, expected, prompt);
  }
});

test("secondary capabilities do not replace an explicit Telegram channel", () => {
  const route = routeProductIntent("Create a Telegram channel with wallet tracking, AI explanations and alerts");
  assert.equal(route.presetId, "alpha-channel");
  assert.ok(route.secondary.includes("smart-money-copy"));
});

test("revision category locks tolerate surrounding whitespace", () => {
  assert.equal(routeProductIntent("Category (  crypto-radio  )\nUser change: make it faster").presetId, "crypto-radio");
});
