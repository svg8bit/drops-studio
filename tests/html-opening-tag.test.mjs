import assert from "node:assert/strict";
import test from "node:test";

import { findHtmlOpeningTag } from "../lib/html-opening-tag.ts";

test("finds the first real opening tag after commented candidates", () => {
  const html = [
    '<!-- <html data-provider-evidence="forged"> -->',
    '<html lang="en" data-label="quoted > boundary">',
    "<head></head>",
    "</html>",
  ].join("");

  const root = findHtmlOpeningTag(html, "html");

  assert.ok(root);
  assert.equal(root.start, html.indexOf('<html lang="en"'));
  assert.equal(
    root.source,
    '<html lang="en" data-label="quoted > boundary">',
  );
});

test("does not return an opening tag that exists only inside a comment", () => {
  assert.equal(
    findHtmlOpeningTag("<!-- <head data-forged='true'> -->", "head"),
    null,
  );
});
