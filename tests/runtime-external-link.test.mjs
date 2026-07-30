import assert from "node:assert/strict";
import test from "node:test";

import { approvedPreviewExternalUrl } from "../lib/runtime-external-link.ts";

const origin = "https://drops-studio.example";

test("allows only explicit official HTTPS preview destinations", () => {
  for (const url of [
    "https://dropstab.com/",
    "https://app.dropstab.com/coins/bitcoin",
    "https://polymarket.com/event/example",
    "https://www.polymarket.com/event/example",
    "https://t.me/Drops",
    "/?connections=1&provider=dropsbot&flow=telegram-channel&project=alpha",
  ]) {
    assert.ok(approvedPreviewExternalUrl(url, origin), url);
  }
});

test("rejects popup bridge confusion, credentials, arbitrary Telegram, and non-HTTPS destinations", () => {
  for (const url of [
    "http://dropstab.com/",
    "https://dropstab.com.evil.example/",
    "https://user@dropstab.com/",
    "https://t.me/NotDrops",
    "https://t.me/Drops?redirect=https://evil.example",
    "/admin",
    "/?connections=1&provider=dropsbot&flow=telegram-channel&next=https://evil.example",
    "javascript:alert(1)",
    "data:text/html,evil",
  ]) {
    assert.equal(approvedPreviewExternalUrl(url, origin), null, url);
  }
});
