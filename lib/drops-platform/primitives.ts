import type { DropsTabCapability } from "./dropstab.ts";

export type GeneratedAppPrimitiveId =
  | "market-table"
  | "coin-search"
  | "price-card"
  | "market-cap-card"
  | "unlock-calendar"
  | "funding-feed"
  | "activity-timeline"
  | "comparison"
  | "research-links"
  | "async-states";

export interface GeneratedAppPrimitiveContract {
  id: GeneratedAppPrimitiveId;
  exportName: string;
  sourcePath: `components/drops/${string}.tsx`;
  description: string;
  capabilities: DropsTabCapability[];
  dataFields: string[];
  fallbackLabel: string;
  moduleSource: string;
}

function source(exportName: string, title: string, content: string): string {
  return `export interface ${exportName}Props {\n  status: "live" | "demo" | "loading" | "error" | "empty";\n  sourceLabel?: string;\n  items?: readonly Record<string, unknown>[];\n}\n\nexport function ${exportName}({ status, sourceLabel, items = [] }: ${exportName}Props) {\n  if (status === "loading") return <section aria-busy="true"><h2>${title}</h2><p>Loading sourced data…</p></section>;\n  if (status === "error") return <section role="alert"><h2>${title}</h2><p>Live data is unavailable. Retry or continue in clearly labelled demo mode.</p></section>;\n  if (status === "empty") return <section><h2>${title}</h2><p>No sourced records match this view.</p></section>;\n  const evidence = status === "live" ? (sourceLabel || "DropsTab") : "Demo sample — not live data";\n  return <section data-source-status={status}><header><h2>${title}</h2><small>{evidence}</small></header>${content}</section>;\n}\n`;
}

export const GENERATED_APP_PRIMITIVE_CONTRACTS: GeneratedAppPrimitiveContract[] = [
  {
    id: "market-table",
    exportName: "DropsMarketTable",
    sourcePath: "components/drops/market-table.tsx",
    description: "Sortable market rows with explicit provider evidence.",
    capabilities: ["coins"],
    dataFields: ["symbol", "name", "price", "marketCap", "change"],
    fallbackLabel: "Demo sample market rows",
    moduleSource: source("DropsMarketTable", "Market intelligence", "<div role=\"table\" aria-label=\"Crypto markets\">{items.map((item, index) => <div role=\"row\" key={String(item.symbol || index)}>{String(item.symbol || \"Unknown\")}</div>)}</div>"),
  },
  {
    id: "coin-search",
    exportName: "DropsCoinSearch",
    sourcePath: "components/drops/coin-search.tsx",
    description: "Local search over normalized coin snapshots.",
    capabilities: ["coins"],
    dataFields: ["symbol", "name"],
    fallbackLabel: "Search unavailable until a live or demo snapshot exists",
    moduleSource: source("DropsCoinSearch", "Coin search", "<label>Search coins<input type=\"search\" placeholder=\"BTC, Solana…\" /></label>"),
  },
  {
    id: "price-card",
    exportName: "DropsPriceCard",
    sourcePath: "components/drops/price-card.tsx",
    description: "Price and 24-hour movement card.",
    capabilities: ["coins"],
    dataFields: ["symbol", "price", "change"],
    fallbackLabel: "Demo sample price",
    moduleSource: source("DropsPriceCard", "Price", "<strong>{String(items[0]?.price || \"Unavailable\")}</strong>"),
  },
  {
    id: "market-cap-card",
    exportName: "DropsMarketCapCard",
    sourcePath: "components/drops/market-cap-card.tsx",
    description: "Market capitalization and FDV context.",
    capabilities: ["coins"],
    dataFields: ["symbol", "marketCap", "fdv"],
    fallbackLabel: "Demo sample valuation",
    moduleSource: source("DropsMarketCapCard", "Valuation", "<dl><dt>Market cap</dt><dd>{String(items[0]?.marketCap || \"Unavailable\")}</dd></dl>"),
  },
  {
    id: "unlock-calendar",
    exportName: "DropsUnlockCalendar",
    sourcePath: "components/drops/unlock-calendar.tsx",
    description: "Upcoming token unlock schedule.",
    capabilities: ["unlocks"],
    dataFields: ["symbol", "nextUnlockAt", "lockedPercent"],
    fallbackLabel: "Unlock schedule unavailable or demo-only",
    moduleSource: source("DropsUnlockCalendar", "Unlock calendar", "<ul>{items.map((item, index) => <li key={index}>{String(item.symbol || \"Token\")} · {String(item.nextUnlockAt || \"Date unavailable\")}</li>)}</ul>"),
  },
  {
    id: "funding-feed",
    exportName: "DropsFundingFeed",
    sourcePath: "components/drops/funding-feed.tsx",
    description: "Funding rounds and investor context.",
    capabilities: ["funding"],
    dataFields: ["symbol", "stage", "raisedUsd", "investors"],
    fallbackLabel: "Funding feed unavailable or demo-only",
    moduleSource: source("DropsFundingFeed", "Funding and investors", "<ul>{items.map((item, index) => <li key={index}>{String(item.symbol || \"Project\")} · {String(item.stage || \"Round\")}</li>)}</ul>"),
  },
  {
    id: "activity-timeline",
    exportName: "DropsActivityTimeline",
    sourcePath: "components/drops/activity-timeline.tsx",
    description: "Dated crypto activity timeline.",
    capabilities: ["activities"],
    dataFields: ["symbol", "activityType", "status", "startAt", "overview"],
    fallbackLabel: "Activity timeline unavailable or demo-only",
    moduleSource: source("DropsActivityTimeline", "Activity timeline", "<ol>{items.map((item, index) => <li key={index}>{String(item.activityType || \"Activity\")}</li>)}</ol>"),
  },
  {
    id: "comparison",
    exportName: "DropsComparison",
    sourcePath: "components/drops/comparison.tsx",
    description: "Side-by-side sourced asset comparison.",
    capabilities: ["coins", "unlocks", "funding"],
    dataFields: ["symbol", "price", "marketCap", "fdv", "nextUnlockAt", "funding"],
    fallbackLabel: "Comparison uses demo samples until sources are connected",
    moduleSource: source("DropsComparison", "Asset comparison", "<div>{items.map((item, index) => <article key={index}><h3>{String(item.symbol || \"Asset\")}</h3></article>)}</div>"),
  },
  {
    id: "research-links",
    exportName: "DropsResearchLinks",
    sourcePath: "components/drops/research-links.tsx",
    description: "Attributed research handoffs without fabricated citations.",
    capabilities: ["coins", "unlocks", "funding", "activities"],
    dataFields: ["label", "href", "provider"],
    fallbackLabel: "Research links unavailable until sourced URLs exist",
    moduleSource: source("DropsResearchLinks", "Research links", "<ul>{items.map((item, index) => <li key={index}>{typeof item.href === \"string\" ? <a href={item.href} rel=\"noreferrer\">{String(item.label || \"Research source\")}</a> : <span>Source unavailable</span>}</li>)}</ul>"),
  },
  {
    id: "async-states",
    exportName: "DropsAsyncState",
    sourcePath: "components/drops/async-states.tsx",
    description: "Shared loading, error, empty, setup, and demo states.",
    capabilities: [],
    dataFields: ["status", "message", "retryLabel"],
    fallbackLabel: "Setup required or demo mode",
    moduleSource: source("DropsAsyncState", "Data status", "<p>{items.length ? String(items[0]?.message || \"Ready\") : \"Setup required\"}</p>"),
  },
];
