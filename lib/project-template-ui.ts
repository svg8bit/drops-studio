import type { GeneratedProjectSpec } from "./project-types.ts";

interface TemplateCopy {
  eyebrow: string;
  headline: string;
  description: string;
  primaryAction: string;
  metrics: readonly string[];
  blocks: readonly string[];
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

const COMPONENT_TEMPLATE = String.raw`"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useDropsTabCoins, type DropsTabCapabilityState } from "../lib/use-dropstab-coins";
__MANAGED_IMPORT__

const product = __PRODUCT_MODEL__ as const;

const MarketContext = createContext<DropsTabCapabilityState>({
  snapshot: null,
  status: "loading",
  error: null,
  refresh: () => undefined,
});

export function useMarketSnapshot() { return useContext(MarketContext); }
export function changeLabel(value: number | null) { return value === null ? "change unavailable" : (value > 0 ? "+" : "") + value.toFixed(2) + "%"; }
function evidenceLabel(market: DropsTabCapabilityState) {
  const evidence = market.snapshot?.evidence;
  if (evidence?.provider === "dropstab" && evidence.verified) return "Live DropsTab /coins · verified";
  if (evidence?.provider === "demo") return "Embedded demo · not live DropsTab data";
  if (market.status === "loading") return "Loading market capability";
  return "Market capability unavailable · local fixtures active";
}

export function Shell({ children, state }: { children: ReactNode; state: string }) {
  const market = useMarketSnapshot();
  return <main><div className="shell"><header className="hero"><div><p className="kicker">{product.eyebrow}</p><h1>{product.headline}</h1><p className="lead">{product.description}</p></div><Notice>{state} · {evidenceLabel(market)}</Notice></header>{children}<footer>DropsTab data is live only when the same-origin server capability returns verified provider evidence. Its embedded demo snapshot is always labelled demo. Drops Bot, Telegram, deployment and every other external action require explicit approval and a confirmed provider receipt.</footer></div></main>;
}

export function Card({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return <section className="card"><p className="kicker">{label}</p><h2>{title}</h2><div className="card-body">{children}</div></section>;
}

export function Button({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="primary" type="button" onClick={onClick}>{children}</button>;
}

export function Notice({ children }: { children: ReactNode }) { return <span className="notice"><i />{children}</span>; }
export function Pill({ children }: { children: ReactNode }) { return <span className="pill">{children}</span>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
export function Row({ label, value }: { label: string; value: string }) { return <div className="row"><span>{label}</span><strong>{value}</strong></div>; }
export function Steps({ items }: { items: readonly string[] }) { return <ol className="steps">{items.map((item, index) => <li key={item + index}><span>{index + 1}</span><p>{item}</p></li>)}</ol>; }

function ActionEngine() {
  const [thesis, setThesis] = useState("ETH liquidity improves after the next unlock window");
  const [confidence, setConfidence] = useState(68);
  const [ledger, setLedger] = useState<string[]>([]);
  const simulate = () => setLedger((items) => [("Scenario checked at " + confidence + "% confidence — no trade executed"), ...items].slice(0, 4));
  return <Shell state="Research-only · approval required for external alerts"><div className="split"><Card title="Thesis graph" label="ASSUMPTIONS → TRIGGERS → INVALIDATION"><label htmlFor="thesis">Working thesis</label><textarea id="thesis" value={thesis} onChange={(event) => setThesis(event.target.value)} /><label htmlFor="confidence">Trigger confidence <strong>{confidence}%</strong></label><input id="confidence" type="range" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /><div className="actions"><Button onClick={simulate}>Run scenario</Button><Pill>Execution disabled</Pill></div></Card><Card title="Scenario checks" label="SAFE DECISION LOOP"><Row label="Bull case" value={confidence >= 60 ? "Trigger active" : "Watch"} /><Row label="Invalidation" value="Liquidity -18%" /><Row label="Drops Bot" value="Setup required" /></Card></div><Card title="Approval ledger" label="AUDIT TRAIL">{ledger.length ? <Steps items={ledger} /> : <Empty>No scenario has been checked yet.</Empty>}</Card></Shell>;
}

function AlphaChannel() {
  const market = useMarketSnapshot();
  const leadCoin = market.snapshot?.coins[0];
  const signals = [leadCoin ? leadCoin.symbol + " " + changeLabel(leadCoin.change24h) + " · market capability" : "SOL +8.4% · embedded demo market", "ARB unlock window · demo context only", "ZK funding round · demo context only"];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = signals[selectedIndex] ?? signals[0];
  const [draft, setDraft] = useState("Review this signal and verify every linked market, wallet and research source before publishing.");
  const [approval, setApproval] = useState("Draft · not delivered");
  return <Shell state="Market evidence shown below · Telegram requires explicit approval"><div className="split reverse"><Card title="Signal inbox" label="MARKET + DEMO-ONLY RESEARCH CONTEXT"><div className="choices">{signals.map((signal, index) => <button className={selectedIndex === index ? "choice active" : "choice"} type="button" key={signal} onClick={() => setSelectedIndex(index)}>{signal}</button>)}</div></Card><Card title="Editorial composer" label="SOURCED POST"><Pill>{selected}</Pill><label htmlFor="post">Draft</label><textarea className="large" id="post" value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="actions"><Button onClick={() => setApproval("Approved locally · Telegram setup required")}>Approve draft</Button><Pill>Evidence state visible</Pill></div><p role="status">{approval}</p></Card></div><Card title="Delivery evidence" label="NO FAKE PUBLICATION"><Row label="Telegram" value="Setup required" /><Row label="Market provider" value={market.snapshot?.evidence.verified ? "DropsTab /coins verified" : "Demo · not verified"} /><Row label="Editorial state" value={approval} /></Card></Shell>;
}

function MorningAlpha() {
  const market = useMarketSnapshot();
  const leader = market.snapshot?.coins[0];
  const baseBrief = [leader ? "Review " + leader.symbol + " " + changeLabel(leader.change24h) + " before the US session" : "Review the embedded demo market before the US session", "Unlock calendar · setup required beyond /coins", "Funding research · setup required beyond /coins"];
  const [offset, setOffset] = useState(0);
  const brief = baseBrief.map((_, index) => baseBrief[(index + offset) % baseBrief.length]);
  return <Shell state="Cached market capability · open provider evidence before acting"><div className="split"><Card title="Priority brief" label="07:30 UTC · DECISION ORDER"><Steps items={brief} /><Button onClick={() => setOffset((value) => (value + 1) % baseBrief.length)}>Re-prioritize brief</Button></Card><Card title="Catalyst calendar" label="DEMO CONTEXT · NOT LIVE"><Steps items={["Today · market pulse", "Unlocks · setup required", "Funding · setup required"]} /></Card></div><div className="metrics"><Metric label={leader?.symbol ?? "Market"} value={changeLabel(leader?.change24h ?? null)} detail={market.snapshot?.evidence.verified ? "Live DropsTab /coins" : "Embedded demo"} /><Metric label="Unlocks" value="Setup" detail="Not provided by /coins" /><Metric label="Research" value="DropsTab" detail="Open original source" /></div></Shell>;
}

function PredictionImpact() {
  const [probability, setProbability] = useState(61);
  const assets = [{ symbol: "BTC", beta: 0.7 }, { symbol: "ETH", beta: 1.1 }, { symbol: "SOL", beta: 1.5 }];
  return <Shell state="Scenario model · probability is not certainty"><div className="split reverse"><Card title="Odds signal" label="USER-CONTROLLED SCENARIO"><div className="big-number">{probability}%</div><label htmlFor="odds">Event probability</label><input id="odds" type="range" min="1" max="99" value={probability} onChange={(event) => setProbability(Number(event.target.value))} /><p className="muted">This control never submits a prediction-market order.</p></Card><Card title="Impact graph" label="SENSITIVITY, NOT FORECAST"><div className="bars">{assets.map((asset) => { const impact = Math.round((probability - 50) * asset.beta * 10) / 10; return <div key={asset.symbol}><div className="bar-label"><strong>{asset.symbol}</strong><span>{impact > 0 ? "+" : ""}{impact}% modeled</span></div><div className="bar"><i style={{ width: String(Math.min(100, Math.max(4, Math.abs(impact) * 4))) + "%" }} /></div></div>; })}</div></Card></div><div className="metrics"><Metric label="Bear" value="35%" detail="Saved locally" /><Metric label="Base" value={String(probability) + "%"} detail="Current scenario" /><Metric label="Bull" value="78%" detail="Saved locally" /></div></Shell>;
}

function WhaleIntelligence() {
  const market = useMarketSnapshot();
  const events = [{ id: "swap", wallet: "0x71…9F", action: "Swapped 420 ETH → USDC", symbol: "ETH", context: "Fixture wallet event · unlock and funding capabilities require setup" }, { id: "bridge", wallet: "7sK…A2", action: "Bridged 18,200 SOL", symbol: "SOL", context: "Fixture wallet event · funding capability requires setup" }];
  const [wallet, setWallet] = useState("");
  const [active, setActive] = useState(events[0]);
  const [alert, setAlert] = useState("Not approved");
  const coin = market.snapshot?.coins.find((item) => item.symbol === active.symbol);
  const marketContext = coin ? coin.symbol + " · " + coin.marketCapLabel + " market cap · " + changeLabel(coin.change24h) : active.context;
  return <Shell state="Fixture wallet events · no custody or trading"><div className="split"><Card title="Tracked wallets" label="MONITORING ONLY"><label htmlFor="wallet">Wallet address</label><div className="inline"><input id="wallet" placeholder="0x… or Solana address" value={wallet} onChange={(event) => setWallet(event.target.value)} /><Button onClick={() => setWallet("")}>Save locally</Button></div><p className="muted">Remote wallet CRUD stays Setup required until the documented provider confirms it.</p><div className="choices">{events.map((event) => <button className={active.id === event.id ? "choice active" : "choice"} type="button" key={event.id} onClick={() => setActive(event)}><strong>{event.wallet}</strong><span>{event.action}</span></button>)}</div></Card><Card title="Enrichment context" label="DROPS TAB /COINS + RULES"><Pill>{active.wallet}</Pill><h3>{active.action}</h3><p>{marketContext}</p><p className="muted">Unlock and funding context is not claimed by this coins-only capability.</p><div className="metrics two"><Metric label="Relevance" value="82 / 100" detail="Rule-based demo score" /><Metric label="Market evidence" value={market.snapshot?.evidence.verified ? "Verified" : "Demo"} detail="Provider state shown above" /></div><div className="actions"><Button onClick={() => setAlert("Approved locally · Telegram setup required")}>Approve alert</Button><Pill>{alert}</Pill></div></Card></div><Card title="Event workflow" label="NORMALIZE → ENRICH → SCORE → APPROVE"><Steps items={[active.action, marketContext, alert]} /></Card></Shell>;
}

function MarketExplorer() {
  const market = useMarketSnapshot();
  const coins = market.snapshot?.coins ?? [];
  const [query, setQuery] = useState("");
  const [compare, setCompare] = useState<string[]>(["BTC", "SOL"]);
  const visible = coins.filter((coin) => (coin.symbol + coin.name).toLowerCase().includes(query.toLowerCase()));
  return <Shell state="Same-origin market capability · live state requires evidence"><Card title="Market explorer" label="SEARCH + RANK + COMPARE"><div className="inline"><div><label htmlFor="coin-search">Coin search</label><input id="coin-search" placeholder="Search symbol or name" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Button onClick={market.refresh}>Refresh market</Button></div><div className="table-wrap"><table><thead><tr><th>Asset</th><th>Price</th><th>24h</th><th>Market cap</th><th>Compare</th></tr></thead><tbody>{visible.map((coin) => <tr key={coin.symbol}><td><strong>{coin.symbol}</strong><span>{coin.name}</span></td><td>{coin.priceLabel}</td><td className={(coin.change24h ?? 0) >= 0 ? "positive" : "negative"}>{changeLabel(coin.change24h)}</td><td>{coin.marketCapLabel}</td><td><button className="small-button" type="button" onClick={() => setCompare((items) => items.includes(coin.symbol) ? items.filter((item) => item !== coin.symbol) : [...items, coin.symbol].slice(-3))}>{compare.includes(coin.symbol) ? "Remove" : "Add"}</button></td></tr>)}</tbody></table></div>{market.status === "loading" ? <Empty>Loading the server capability…</Empty> : null}{market.error ? <Empty>{market.error}</Empty> : null}</Card><Card title="Comparison" label="LOCAL WATCHLIST"><div className="actions">{compare.map((symbol) => <Pill key={symbol}>{symbol}</Pill>)}</div></Card></Shell>;
}

function MarketGame() {
  const market = useMarketSnapshot();
  const capabilityRounds = (market.snapshot?.coins ?? []).filter((coin) => coin.change24h !== null).slice(0, 4).map((coin) => ({ asset: coin.symbol, move: coin.change24h ?? 0 }));
  const rounds = capabilityRounds.length ? capabilityRounds : [{ asset: "SOL", move: 8.4 }, { asset: "ETH", move: -1.2 }, { asset: "ARB", move: 3.1 }, { asset: "BTC", move: 2.8 }];
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState("Choose whether the asset moved up or down");
  const current = rounds[round % rounds.length];
  const play = (guess: "up" | "down") => { const correct = (current.move >= 0 && guess === "up") || (current.move < 0 && guess === "down"); setScore((value) => value + (correct ? 100 : 0)); setMessage(correct ? "Correct — " + current.asset + " moved " + current.move + "%" : "Missed — " + current.asset + " moved " + current.move + "%"); setRound((value) => value + 1); };
  return <Shell state="Playable market round · prices are labeled fixtures unless provider evidence is verified"><section className="arena"><p className="kicker">MARKET MOMENTUM RUN · ROUND {round + 1}</p><div className="coin">{current.asset}</div><h2>Did this asset move up or down?</h2><div className="game-actions"><button className="up" type="button" onClick={() => play("up")}>↑ Momentum up</button><button className="down" type="button" onClick={() => play("down")}>↓ Momentum down</button></div><p role="status">{message}</p></section><div className="metrics"><Metric label="Local score" value={String(score)} detail="Not an asset balance" /><Metric label="Round" value={String(round + 1)} detail="Four-asset loop" /><Metric label="Data mode" value={market.snapshot?.evidence.verified ? "DropsTab" : "Demo"} detail={market.snapshot?.evidence.verified ? "Verified /coins snapshot" : "Embedded fixture, not live"} /></div></Shell>;
}

function PersonalCompanion() {
  const assets = ["BTC", "ETH", "SOL", "ARB"];
  const [focus, setFocus] = useState<string[]>(["BTC", "SOL"]);
  const [tone, setTone] = useState("Balanced");
  return <Shell state="Preferences stay in this local demo session"><div className="split reverse"><Card title="Memory controls" label="YOU CONTROL THE CONTEXT"><div className="actions">{assets.map((asset) => <button type="button" className={focus.includes(asset) ? "toggle selected" : "toggle"} key={asset} onClick={() => setFocus((items) => items.includes(asset) ? items.filter((item) => item !== asset) : [...items, asset])}>{asset}</button>)}</div><label htmlFor="tone">Brief style</label><select id="tone" value={tone} onChange={(event) => setTone(event.target.value)}><option>Balanced</option><option>Concise</option><option>Risk-first</option></select></Card><Card title="Daily focus" label={tone.toUpperCase() + " BRIEF"}><h3>Watch {focus.join(" + ") || "no assets"}</h3><p>SOL leads the demo snapshot while BTC remains the liquidity anchor. Open source evidence before changing a decision.</p><div className="actions"><Pill>Personal</Pill><Pill>Local persistence</Pill><Pill>No wallet access</Pill></div></Card></div><Card title="Recommendations" label="WHY THIS APPEARS"><Steps items={focus.map((asset) => asset + ": selected in your focus controls")} /></Card></Shell>;
}

function PortfolioPal() {
  const [energy, setEnergy] = useState(62);
  const [mood, setMood] = useState("Curious");
  const care = (action: string, delta: number) => { setEnergy((value) => Math.min(100, value + delta)); setMood(action); };
  return <Shell state="Local character game · no connected balances"><section className="habitat"><div className="character" aria-label={"Portfolio companion is " + mood}>◉‿◉</div><div><p className="kicker">PORTFOLIO PAL · {mood.toUpperCase()}</p><h2>Energy {energy}/100</h2><div className="energy"><i style={{ width: String(energy) + "%" }} /></div><div className="actions"><Button onClick={() => care("Researched", 8)}>Feed research</Button><Button onClick={() => care("Calm", 5)}>Review risk</Button><Button onClick={() => care("Playful", 3)}>Market walk</Button></div></div></section><div className="metrics"><Metric label="Mood" value={mood} detail="Reacted to your care" /><Metric label="Care streak" value="3 days" detail="Browser-local demo" /><Metric label="Market mood" value="Cautious" detail="Fixture, not live" /></div></Shell>;
}

function ProductHunt() {
  const seed = [{ name: "Wallet Lens", category: "Analytics", votes: 84 }, { name: "Unlock Radar", category: "Research", votes: 61 }, { name: "Chain Arcade", category: "Games", votes: 42 }];
  const [products, setProducts] = useState(seed);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("All");
  const submit = () => { if (!name.trim()) return; setProducts((items) => [{ name: name.trim(), category: "Draft", votes: 0 }, ...items]); setName(""); };
  return <Shell state="Local launch board · community backend setup required"><div className="split"><Card title="Launch feed" label="CURATED CRYPTO PRODUCTS"><div className="actions">{["All", "Analytics", "Research", "Games"].map((item) => <button type="button" className={filter === item ? "toggle selected" : "toggle"} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="launches">{products.filter((item) => filter === "All" || item.category === filter).map((item) => <article key={item.name}><div><strong>{item.name}</strong><span>{item.category}</span></div><button className="small-button" type="button" onClick={() => setProducts((items) => items.map((productItem) => productItem.name === item.name ? { ...productItem, votes: productItem.votes + 1 } : productItem))}>▲ {item.votes}</button></article>)}</div></Card><Card title="Submission studio" label="LOCAL DRAFT"><label htmlFor="product-name">Product name</label><input id="product-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New crypto product" /><Button onClick={submit}>Create local draft</Button><p className="muted">Public submission stays pending until project-data confirms a durable write.</p></Card></div></Shell>;
}

function CryptoRadio() {
  const market = useMarketSnapshot();
  const stations = [
    { name: "Market Pulse", format: "Prices and catalysts" },
    { name: "Wallet Signal", format: "Whale activity" },
    { name: "Unlock Desk", format: "Supply events" },
    { name: "Funding Wire", format: "Rounds and investors" },
  ] as const;
  const [stationIndex, setStationIndex] = useState(0);
  const [queue, setQueue] = useState([
    { title: "Market open", kind: "MARKET", duration: "02:30", script: "Bitcoin and Ethereum set the market tone. Review the verified provider state before treating any price as current." },
    { title: "Unlock watch", kind: "CATALYST", duration: "04:10", script: "Token unlock context remains setup-required until the connected capability returns provider evidence." },
    { title: "Wallet pulse", kind: "WALLETS", duration: "03:20", script: "Wallet events require a verified Drops Bot webhook. No wallet action is executed from this briefing." },
  ]);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [script, setScript] = useState(queue[0].script);
  const [playing, setPlaying] = useState(false);
  const [playback, setPlayback] = useState("Ready in browser");
  const [volume, setVolume] = useState(72);
  const currentSegment = queue[segmentIndex] ?? queue[0];
  const coins = (market.snapshot?.coins ?? []).slice(0, 4);
  const selectSegment = (index: number) => {
    const next = queue[index];
    if (!next) return;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setPlaying(false);
    setSegmentIndex(index);
    setScript(next.script);
    setPlayback("Ready in browser");
  };
  const nextSegment = () => selectSegment((segmentIndex + 1) % queue.length);
  const togglePlayback = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setPlayback("Browser speech is unavailable");
      return;
    }
    if (playing) {
      window.speechSynthesis.cancel();
      setPlaying(false);
      setPlayback("Playback stopped");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    utterance.volume = volume / 100;
    utterance.onend = () => { setPlaying(false); setPlayback("Segment complete"); };
    utterance.onerror = () => { setPlaying(false); setPlayback("Playback could not start"); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setPlaying(true);
    setPlayback("Browser speech active");
  };
  const updateScript = (value: string) => {
    setScript(value);
    setQueue((items) => items.map((item, index) => index === segmentIndex ? { ...item, script: value } : item));
  };
  const addSegment = () => {
    const next = { title: "New desk note", kind: "DRAFT", duration: "02:00", script: "Add sourced market context for this new segment." };
    setQueue((items) => [...items, next]);
    setSegmentIndex(queue.length);
    setScript(next.script);
    setPlayback("Draft segment added");
  };
  return <main className="radio-main"><div className="radio-shell">
    <header className="radio-header"><a className="radio-brand" href="#live"><span>DROPS RADIO</span><small>BY DROPS STUDIO</small></a><nav aria-label="Radio sections"><a href="#live">Live</a><a href="#market">Market</a><a href="#rundown">Rundown editor</a></nav><span className="radio-status">{playing ? "ON AIR IN BROWSER" : "READY"}</span></header>
    <section className="radio-hero" id="live"><div className="radio-intro"><p className="radio-overline">{product.eyebrow}</p><h1>{product.headline}</h1><p>{product.description}</p><div className="radio-evidence"><strong>{evidenceLabel(market)}</strong><span>Speech stays on this device. Distribution requires approval.</span></div></div><div className="radio-player"><div className="radio-player-top"><span>{stations[stationIndex].name}</span><strong>{currentSegment.kind}</strong></div><p className="radio-track-label">NOW PLAYING</p><h2>{currentSegment.title}</h2><p>{script}</p><div className="radio-controls"><button type="button" onClick={togglePlayback}>{playing ? "Stop" : "Play briefing"}</button><button type="button" onClick={nextSegment}>Next segment</button></div><label htmlFor="radio-volume">Volume <strong>{volume}%</strong></label><input id="radio-volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><p className="radio-playback" role="status">{playback}</p></div></section>
    <section className="radio-section"><div className="radio-section-heading"><div><p>CHOOSE A FREQUENCY</p><h2>Four crypto desks, one broadcast</h2></div><span>Browser-generated audio</span></div><div className="radio-stations">{stations.map((station, index) => <button type="button" className={stationIndex === index ? "active" : ""} key={station.name} onClick={() => { setStationIndex(index); setPlayback(station.name + " selected"); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{station.name}</strong><small>{station.format}</small></button>)}</div></section>
    <section className="radio-section" id="market"><div className="radio-section-heading"><div><p>MARKET SNAPSHOT</p><h2>On the radar</h2></div><button className="radio-text-button" type="button" onClick={market.refresh}>Refresh evidence</button></div><div className="radio-market">{coins.length ? coins.map((coin) => <article key={coin.symbol}><span>{coin.symbol}</span><strong>{coin.priceLabel}</strong><small className={(coin.change24h ?? 0) >= 0 ? "positive" : "negative"}>{changeLabel(coin.change24h)} · {coin.marketCapLabel}</small></article>) : <article className="radio-market-empty"><strong>{market.status === "loading" ? "Market capability loading" : market.error || "Market capability unavailable"}</strong><small>{market.status === "loading" ? "Checking the same-origin data capability." : "Retry the capability; no live market result is being claimed."}</small></article>}</div></section>
    <section className="radio-editor" id="rundown"><div className="radio-queue"><div className="radio-section-heading"><div><p>TODAY&apos;S RUNDOWN</p><h2>Stories in the queue</h2></div><span>{queue.length} segments</span></div>{queue.map((segment, index) => <button type="button" className={segmentIndex === index ? "active" : ""} key={segment.title + index} onClick={() => selectSegment(index)}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{segment.kind}</small><strong>{segment.title}</strong></div><b>{segment.duration}</b></button>)}</div><div className="radio-script"><p>RUNDOWN EDITOR</p><h2>{currentSegment.title}</h2><label htmlFor="radio-script">Segment script</label><textarea id="radio-script" value={script} onChange={(event) => updateScript(event.target.value)} /><div className="radio-controls"><button type="button" onClick={togglePlayback}>{playing ? "Stop preview" : "Preview script"}</button><button type="button" onClick={addSegment}>Add segment</button></div><small>Edits stay local to this project until you save, build and publish.</small></div></section>
    <section className="radio-section"><div className="radio-section-heading"><div><p>FROM THE ARCHIVE</p><h2>Research without the noise</h2></div><span>Editorial demo queue</span></div><div className="radio-archive"><article><span>01</span><div><small>PRIVACY</small><strong>Why the market needs verifiable context</strong><p>Evidence-first research for every crypto workflow.</p></div><b>18 MIN</b></article><article><span>02</span><div><small>INFRASTRUCTURE</small><strong>Wallet monitoring without custody</strong><p>Drops Bot events, rules and approval boundaries.</p></div><b>24 MIN</b></article><article><span>03</span><div><small>MARKETS</small><strong>Unlocks, funding and the next catalyst</strong><p>What to verify before a signal becomes a story.</p></div><b>12 MIN</b></article></div></section>
    <footer className="radio-footer"><strong>Drops Radio</strong><span>DropsTab data is live only with verified provider evidence. Drops Bot, Telegram and public distribution remain setup-required until a confirmed provider receipt.</span></footer>
  </div></main>;
}

function CryptoAssistant() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([{ role: "assistant", text: "Ask about a market move, unlock or funding event." }]);
  const ask = () => { if (!question.trim()) return; setMessages((items) => [...items, { role: "you", text: question.trim() }, { role: "assistant", text: "Demo answer: SOL leads the stored snapshot. Connect DropsTab and open its evidence before treating this as current." }]); setQuestion(""); };
  return <Shell state="Evidence-first assistant · no wallet execution"><div className="split"><Card title="Conversation" label="FOCUSED CRYPTO QUESTIONS"><div className="chat" aria-live="polite">{messages.map((message, index) => <div className={message.role === "you" ? "message you" : "message"} key={message.role + index}><span>{message.role}</span><p>{message.text}</p></div>)}</div><div className="inline"><input aria-label="Ask a crypto question" placeholder="Why is SOL moving?" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") ask(); }} /><Button onClick={ask}>Ask</Button></div></Card><Card title="Evidence drawer" label="PROVIDER STATE"><Row label="Market snapshot" value="Demo" /><Row label="Unlock context" value="Setup required" /><Row label="Wallet actions" value="Disabled" /></Card></div></Shell>;
}

function CustomProduct() {
  const modules: readonly string[] = product.modules.length ? product.modules : ["Primary workflow", "Sourced data", "Local persistence"];
  const [active, setActive] = useState(modules[0]);
  const managed = useManagedCollection("workflow_items");
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState("");
  const add = async () => { if (!draft.trim()) return; try { await managed.addItem(draft); setDraft(""); setSaveError(""); } catch { setSaveError("Wait for the managed backend check, then try again."); } };
  return <Shell state="Native multi-file app · managed writes require a server capability"><div className="split reverse"><Card title="Product map" label="PROMPT-DERIVED MODULES"><div className="choices">{modules.map((module) => <button type="button" className={module === active ? "choice active" : "choice"} key={module} onClick={() => setActive(module)}>{module}</button>)}</div></Card><Card title={active} label="EDITABLE PRIMARY WORKFLOW"><label htmlFor="custom-item">Add a workflow item</label><div className="inline"><input id="custom-item" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Describe an item" /><Button onClick={() => void add()}>Add item</Button></div><p role="status">{saveError || managed.status}</p>{managed.items.length ? <Steps items={managed.items.map((item) => item.title)} /> : <Empty>{product.emptyState}</Empty>}</Card></div><div className="metrics"><Metric label="DropsTab" value="Demo" detail="Proxy-ready" /><Metric label="Project data" value={managed.mode === "managed" ? "Managed" : managed.mode === "loading" ? "Checking" : "Local"} detail={managed.status} /><Metric label="External actions" value="Approval" detail="Never automatic" /></div></Shell>;
}

const products = {
  "action-engine": ActionEngine,
  "alpha-channel": AlphaChannel,
  "morning-alpha": MorningAlpha,
  "prediction-impact": PredictionImpact,
  "smart-money-copy": WhaleIntelligence,
  "crypto-aggregator": MarketExplorer,
  "crypto-game": MarketGame,
  "personal-companion": PersonalCompanion,
  "portfolio-tamagotchi": PortfolioPal,
  "crypto-product-hunt": ProductHunt,
  "crypto-radio": CryptoRadio,
  "crypto-siri": CryptoAssistant,
  "custom-product": CustomProduct,
} as const;

export function CryptoProduct() {
  const Product = products[product.presetId];
  return <Product />;
}
`;

const COMPONENT_NAME_BY_PRESET: Record<
  GeneratedProjectSpec["presetId"],
  | "ActionEngine"
  | "AlphaChannel"
  | "MorningAlpha"
  | "PredictionImpact"
  | "WhaleIntelligence"
  | "MarketExplorer"
  | "MarketGame"
  | "PersonalCompanion"
  | "PortfolioPal"
  | "ProductHunt"
  | "CryptoRadio"
  | "CryptoAssistant"
  | "CustomProduct"
> = {
  "action-engine": "ActionEngine",
  "alpha-channel": "AlphaChannel",
  "morning-alpha": "MorningAlpha",
  "prediction-impact": "PredictionImpact",
  "smart-money-copy": "WhaleIntelligence",
  "crypto-aggregator": "MarketExplorer",
  "crypto-game": "MarketGame",
  "personal-companion": "PersonalCompanion",
  "portfolio-tamagotchi": "PortfolioPal",
  "crypto-product-hunt": "ProductHunt",
  "crypto-radio": "CryptoRadio",
  "crypto-siri": "CryptoAssistant",
  "custom-product": "CustomProduct",
};

function selectCategoryComponent(
  template: string,
  componentName: (typeof COMPONENT_NAME_BY_PRESET)[GeneratedProjectSpec["presetId"]],
): string {
  const firstCategoryStart = template.indexOf("function ActionEngine()");
  const selectedStart = template.indexOf(`function ${componentName}()`);
  const componentRegistryStart = template.indexOf("const products = {");
  const nextComponentStart = template.indexOf("\nfunction ", selectedStart + 1);
  const selectedEnd =
    nextComponentStart >= 0 && nextComponentStart < componentRegistryStart
      ? nextComponentStart
      : componentRegistryStart;

  if (
    firstCategoryStart < 0 ||
    selectedStart < firstCategoryStart ||
    selectedEnd <= selectedStart
  ) {
    throw new Error(`Unable to materialize category component ${componentName}.`);
  }

  const prelude = template.slice(0, firstCategoryStart).trimEnd();
  const selected = template.slice(selectedStart, selectedEnd).trim();
  return `${prelude}\n\n${selected}\n\nexport function CryptoProduct() {\n  const capability = useDropsTabCoins();\n  return <MarketContext.Provider value={capability}><${componentName} /></MarketContext.Provider>;\n}\n`;
}

export const PROJECT_TEMPLATE_GLOBAL_CSS = String.raw`@import "tailwindcss";

:root { color-scheme: dark; --project-accent: #67e8f9; --project-surface: #070a12; --project-radius: 20px; --project-font: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; overflow-x: clip; background: var(--project-surface); font-family: var(--project-font); }
button, a, input, textarea, select { touch-action: manipulation; }
button, input, textarea, select { font: inherit; }
main { min-height: 100vh; padding: 20px 16px; color: #f8fafc; }
.shell { display: grid; max-width: 1240px; gap: 20px; margin: 0 auto; }
.hero { display: grid; gap: 24px; border: 1px solid rgb(255 255 255 / .1); border-radius: calc(var(--project-radius) + 8px); background: linear-gradient(145deg, rgb(15 23 42 / .98), rgb(8 13 24 / .98)); padding: clamp(24px, 4vw, 48px); box-shadow: 0 24px 90px rgb(0 0 0 / .32); }
.hero h1 { max-width: 1000px; margin: 12px 0 0; font-size: clamp(2.25rem, 6vw, 5rem); line-height: .98; letter-spacing: -.045em; }
.lead { max-width: 780px; margin: 18px 0 0; color: #cbd5e1; font-size: 1.05rem; line-height: 1.75; }
.kicker { margin: 0; color: var(--project-accent); font-size: .75rem; font-weight: 800; letter-spacing: .16em; }
.notice { display: inline-flex; min-height: 44px; width: fit-content; align-items: center; gap: 10px; border: 1px solid rgb(255 255 255 / .1); border-radius: 999px; padding: 10px 14px; color: #cbd5e1; font-size: .82rem; }
.notice i { width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 20px #fbbf24aa; }
.split { display: grid; gap: 20px; }
.card { min-width: 0; border: 1px solid rgb(255 255 255 / .1); border-radius: 24px; background: rgb(15 23 42 / .76); padding: clamp(20px, 3vw, 28px); }
.card h2 { margin: 9px 0 0; font-size: 1.55rem; letter-spacing: -.025em; }
.card h3 { margin: 22px 0 0; font-size: 1.55rem; }
.card-body { display: grid; gap: 16px; margin-top: 20px; }
label { display: block; margin: 4px 0 8px; color: #cbd5e1; font-size: .875rem; font-weight: 700; }
input:not([type="range"]), textarea, select { min-height: 48px; width: 100%; border: 1px solid rgb(255 255 255 / .14); border-radius: 14px; background: #090f1d; padding: 12px 14px; color: #f8fafc; outline: none; }
textarea { min-height: 112px; resize: vertical; } textarea.large { min-height: 210px; }
input:focus, textarea:focus, select:focus { border-color: var(--project-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--project-accent) 14%, transparent); }
input[type="range"] { min-height: 44px; width: 100%; accent-color: var(--project-accent); }
.primary, .game-actions button { min-height: 48px; border: 0; border-radius: 14px; background: var(--project-accent); padding: 12px 18px; color: #07111c; font-weight: 800; cursor: pointer; }
.primary:hover, .game-actions button:hover { filter: brightness(1.08); }
.actions, .inline { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.inline input { flex: 1 1 220px; }
.pill, .toggle { display: inline-flex; min-height: 44px; align-items: center; border: 1px solid rgb(255 255 255 / .12); border-radius: 999px; background: rgb(15 23 42 / .8); padding: 9px 13px; color: #cbd5e1; font-size: .8rem; }
.toggle { cursor: pointer; } .toggle.selected { border-color: var(--project-accent); color: var(--project-accent); }
.choices { display: grid; gap: 9px; }
.choice { display: grid; min-height: 48px; gap: 4px; width: 100%; border: 1px solid rgb(255 255 255 / .1); border-radius: 14px; background: #0a1020; padding: 13px 14px; color: #cbd5e1; text-align: left; cursor: pointer; }
.choice span { color: #94a3b8; font-size: .8rem; } .choice.active { border-color: var(--project-accent); background: color-mix(in srgb, var(--project-accent) 12%, transparent); color: white; }
.metrics { display: grid; gap: 12px; } .metric { display: grid; min-height: 128px; gap: 7px; border: 1px solid rgb(255 255 255 / .1); border-radius: 18px; background: #0a1020; padding: 18px; }
.metric span { color: #94a3b8; font-size: .82rem; } .metric strong { font-size: 1.6rem; } .metric small { color: #94a3b8; }
.row { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid rgb(255 255 255 / .08); color: #94a3b8; } .row strong { color: #f8fafc; text-align: right; }
.steps { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; } .steps li { display: grid; grid-template-columns: 34px 1fr; align-items: start; gap: 12px; } .steps li > span { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 12px; background: rgb(103 232 249 / .12); color: #67e8f9; font-size: .78rem; font-weight: 800; } .steps p { margin: 6px 0 0; color: #cbd5e1; }
.empty { border: 1px dashed rgb(255 255 255 / .16); border-radius: 16px; padding: 22px; color: #94a3b8; line-height: 1.65; } .muted { color: #94a3b8; font-size: .85rem; line-height: 1.65; }
.big-number { font-size: clamp(3.5rem, 9vw, 7rem); font-weight: 800; letter-spacing: -.06em; }
.bars { display: grid; gap: 22px; } .bar-label { display: flex; justify-content: space-between; margin-bottom: 8px; } .bar { height: 12px; border-radius: 999px; background: #1e293b; } .bar i { display: block; height: 100%; border-radius: inherit; background: #e879f9; }
.table-wrap { overflow-x: auto; } table { width: 100%; min-width: 620px; border-collapse: collapse; } th, td { border-bottom: 1px solid rgb(255 255 255 / .08); padding: 14px; text-align: left; } th { color: #64748b; font-size: .75rem; letter-spacing: .1em; text-transform: uppercase; } td span { display: block; color: #64748b; font-size: .8rem; } .positive { color: #6ee7b7; } .negative { color: #fda4af; }
.small-button { min-height: 44px; border: 1px solid color-mix(in srgb, var(--project-accent) 35%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--project-accent) 8%, transparent); padding: 8px 12px; color: var(--project-accent); cursor: pointer; }
.arena { overflow: hidden; border: 1px solid rgb(103 232 249 / .24); border-radius: 32px; background: radial-gradient(circle at top, #22d3ee22, transparent 54%), linear-gradient(145deg, #111b32, #090d19); padding: clamp(28px, 6vw, 64px) 20px; text-align: center; }
.coin { display: grid; width: 160px; height: 160px; place-items: center; margin: 32px auto; border: 1px solid rgb(103 232 249 / .4); border-radius: 44px; background: rgb(103 232 249 / .1); color: #f8fafc; font-size: 3rem; font-weight: 900; box-shadow: 0 0 80px #22d3ee33; }
.game-actions { display: flex; justify-content: center; gap: 14px; margin: 24px 0; } .game-actions .up { background: #6ee7b7; } .game-actions .down { background: #fda4af; }
.habitat { display: grid; gap: 28px; align-items: center; border: 1px solid rgb(167 139 250 / .25); border-radius: 28px; background: linear-gradient(135deg, rgb(76 29 149 / .24), rgb(8 145 178 / .15)); padding: clamp(24px, 5vw, 48px); }
.character { display: grid; aspect-ratio: 1; width: min(220px, 60vw); place-items: center; border: 2px solid rgb(255 255 255 / .22); border-radius: 42% 58% 52% 48%; background: linear-gradient(135deg, #a78bfa, #67e8f9); color: #111827; font-size: 3.5rem; box-shadow: 0 22px 80px rgb(103 232 249 / .24); }
.energy { height: 16px; overflow: hidden; border-radius: 999px; background: #1e293b; } .energy i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #a78bfa, #67e8f9); }
.launches { display: grid; gap: 10px; } .launches article { display: flex; min-height: 66px; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid rgb(255 255 255 / .09); border-radius: 16px; background: #0a1020; padding: 14px; } .launches article div { display: grid; gap: 4px; } .launches span { color: #94a3b8; font-size: .8rem; }
.disc { display: grid; width: 150px; height: 150px; place-items: center; border: 2px solid rgb(255 255 255 / .2); border-radius: 50%; background: repeating-radial-gradient(circle, #111827 0 9px, #1e293b 10px 11px); color: var(--project-accent); font-size: 2rem; box-shadow: 0 0 60px rgb(103 232 249 / .12); }
.radio-main { min-height: 100vh; padding: 0; background: #080d10; color: #f5f8f3; }
.radio-shell { width: min(100%, 1480px); margin: 0 auto; border-inline: 1px solid #263035; background: linear-gradient(90deg, transparent 49.8%, rgb(255 255 255 / .035) 50%, transparent 50.2%); }
.radio-header { position: sticky; z-index: 5; top: 0; display: grid; min-height: 76px; grid-template-columns: minmax(190px, 1fr) auto minmax(190px, 1fr); align-items: center; gap: 24px; border-bottom: 1px solid #263035; background: rgb(8 13 16 / .94); padding: 0 clamp(20px, 4vw, 54px); backdrop-filter: blur(18px); }
.radio-brand { display: inline-grid; width: fit-content; color: #f5f8f3; text-decoration: none; }
.radio-brand span { font-size: 16px; font-weight: 900; letter-spacing: .06em; }
.radio-brand small { margin-top: 3px; color: var(--project-accent); font-size: 12px; font-weight: 800; letter-spacing: .14em; }
.radio-header nav { display: flex; gap: 28px; }
.radio-header nav a { display: inline-flex; min-height: 44px; align-items: center; color: #98a6ab; font-size: 14px; font-weight: 750; text-decoration: none; }
.radio-header nav a:hover, .radio-header nav a:focus-visible { color: #fff; }
.radio-status { justify-self: end; border: 1px solid color-mix(in srgb, var(--project-accent) 54%, #263035); border-radius: 999px; padding: 9px 12px; color: var(--project-accent); font-size: 12px; font-weight: 850; letter-spacing: .1em; }
.radio-hero { display: grid; min-height: 650px; grid-template-columns: minmax(0, 1.15fr) minmax(380px, .85fr); border-bottom: 1px solid #263035; }
.radio-intro { display: flex; min-width: 0; flex-direction: column; justify-content: center; padding: clamp(56px, 8vw, 120px) clamp(24px, 6vw, 92px); }
.radio-overline, .radio-section-heading p, .radio-script > p { margin: 0; color: var(--project-accent); font-size: 12px; font-weight: 850; letter-spacing: .18em; }
.radio-intro h1 { max-width: 100%; margin: 20px 0 26px; font-size: clamp(2.75rem, 5.8vw, 5.4rem); font-weight: 900; line-height: .9; letter-spacing: -.065em; overflow-wrap: anywhere; text-wrap: balance; text-transform: uppercase; }
.radio-intro > p:not(.radio-overline) { max-width: 680px; margin: 0; color: #a7b2b7; font-size: 17px; line-height: 1.65; }
.radio-evidence { display: grid; gap: 5px; margin-top: 42px; padding-left: 16px; border-left: 3px solid var(--project-accent); }
.radio-evidence strong { font-size: 13px; }
.radio-evidence span { color: #7e8c91; font-size: 12px; }
.radio-player { align-self: center; min-width: 0; margin: 38px clamp(24px, 4vw, 58px) 38px 0; border: 1px solid #313d42; background: #0d1417; padding: clamp(24px, 4vw, 44px); box-shadow: 0 28px 80px rgb(0 0 0 / .34); }
.radio-player-top { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #263035; color: #aab5b9; font-size: 12px; }
.radio-player-top strong { color: var(--project-accent); font-size: 12px; letter-spacing: .12em; }
.radio-track-label { margin: 34px 0 12px; color: #6f7d82; font-size: 12px; font-weight: 800; letter-spacing: .12em; }
.radio-player h2 { margin: 0; font-size: clamp(2.3rem, 4.8vw, 4.6rem); line-height: .92; letter-spacing: -.055em; }
.radio-player > p:not(.radio-track-label, .radio-playback) { min-height: 74px; color: #a9b4b8; font-size: 14px; line-height: 1.65; }
.radio-controls { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0; }
.radio-controls button, .radio-text-button { min-height: 46px; border: 1px solid #364247; background: transparent; padding: 11px 16px; color: #f5f8f3; font-weight: 800; cursor: pointer; }
.radio-controls button:first-child { border-color: var(--project-accent); background: var(--project-accent); color: #091012; }
.radio-controls button:hover, .radio-text-button:hover { border-color: var(--project-accent); color: var(--project-accent); }
.radio-player label { display: flex; justify-content: space-between; margin-top: 18px; color: #8a999e; }
.radio-playback { margin: 8px 0 0; color: var(--project-accent); font-size: 12px; }
.radio-section { border-bottom: 1px solid #263035; padding: clamp(52px, 6vw, 88px) clamp(24px, 6vw, 92px); }
.radio-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 34px; }
.radio-section-heading h2, .radio-script h2 { margin: 10px 0 0; font-size: clamp(2.4rem, 5vw, 5rem); line-height: .92; letter-spacing: -.055em; text-transform: uppercase; }
.radio-section-heading > span { color: #7f8d92; font-size: 12px; }
.radio-stations { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.radio-stations button { display: grid; min-height: 176px; gap: 12px; border: 1px solid #293338; border-right: 0; background: #0a1013; padding: 24px; color: #f5f8f3; text-align: left; cursor: pointer; }
.radio-stations button:last-child { border-right: 1px solid #293338; }
.radio-stations button.active { border-color: var(--project-accent); background: color-mix(in srgb, var(--project-accent) 8%, #0a1013); }
.radio-stations button > span { color: #69777c; font-family: ui-monospace, monospace; font-size: 12px; }
.radio-stations strong { align-self: end; font-size: 22px; letter-spacing: -.03em; }
.radio-stations small { color: #7d8a8f; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.radio-market { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid #293338; border-left: 1px solid #293338; }
.radio-market article { display: grid; min-height: 170px; gap: 12px; padding: 26px; border-right: 1px solid #293338; border-bottom: 1px solid #293338; }
.radio-market article > span { color: #8e9ba0; font-size: 12px; font-weight: 850; }
.radio-market article > strong { align-self: end; font-size: clamp(1.65rem, 3vw, 3rem); letter-spacing: -.04em; }
.radio-market article > small { font-size: 12px; }
.radio-market-empty { grid-column: 1 / -1; }
.radio-text-button { margin: 0; }
.radio-editor { display: grid; grid-template-columns: minmax(0, 1.06fr) minmax(360px, .94fr); border-bottom: 1px solid #263035; }
.radio-queue { min-width: 0; padding: clamp(52px, 6vw, 88px) clamp(24px, 5vw, 72px); border-right: 1px solid #263035; }
.radio-queue > button { display: grid; min-height: 112px; width: 100%; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 18px; border: 0; border-top: 1px solid #293338; background: transparent; padding: 18px 8px; color: #f5f8f3; text-align: left; cursor: pointer; }
.radio-queue > button:last-child { border-bottom: 1px solid #293338; }
.radio-queue > button.active { background: color-mix(in srgb, var(--project-accent) 6%, transparent); }
.radio-queue > button > span { color: #738086; font-family: ui-monospace, monospace; font-size: 12px; }
.radio-queue > button > div { display: grid; gap: 7px; }
.radio-queue > button small { color: var(--project-accent); font-size: 12px; font-weight: 850; letter-spacing: .13em; }
.radio-queue > button strong { font-size: 19px; }
.radio-queue > button b { font-size: 12px; }
.radio-script { min-width: 0; padding: clamp(52px, 6vw, 88px) clamp(24px, 5vw, 72px); background: #0c1316; }
.radio-script h2 { font-size: clamp(2.2rem, 4vw, 4.2rem); }
.radio-script label { margin-top: 30px; }
.radio-script textarea { min-height: 240px; border-radius: 0; background: #070c0e; line-height: 1.65; }
.radio-script > small { display: block; color: #77858a; line-height: 1.6; }
.radio-archive { display: grid; }
.radio-archive article { display: grid; min-height: 132px; grid-template-columns: 52px minmax(0, 1fr) auto; align-items: center; gap: 28px; border-top: 1px solid #293338; padding: 20px 8px; }
.radio-archive article:last-child { border-bottom: 1px solid #293338; }
.radio-archive article > span { color: #738086; font-family: ui-monospace, monospace; font-size: 12px; }
.radio-archive article > div { display: grid; grid-template-columns: minmax(180px, .65fr) minmax(240px, 1fr); align-items: center; gap: 24px; }
.radio-archive small { color: var(--project-accent); font-size: 12px; font-weight: 850; letter-spacing: .13em; }
.radio-archive strong { font-size: 22px; letter-spacing: -.025em; }
.radio-archive p { margin: 0; color: #7d8a8f; font-size: 13px; line-height: 1.55; }
.radio-archive b { font-size: 12px; }
.radio-footer { display: grid; grid-template-columns: auto minmax(0, 740px); justify-content: space-between; gap: 30px; padding: 34px clamp(24px, 6vw, 92px); color: #77858a; }
.radio-footer strong { color: #f5f8f3; }
.radio-footer span { font-size: 12px; line-height: 1.65; }
.chat { display: grid; max-height: 430px; gap: 12px; overflow: auto; } .message { max-width: 85%; border-radius: 16px 16px 16px 4px; background: #111b30; padding: 14px; } .message.you { margin-left: auto; border-radius: 16px 16px 4px 16px; background: rgb(8 145 178 / .2); } .message span { color: #67e8f9; font-size: .75rem; font-weight: 800; text-transform: uppercase; } .message p { margin: 6px 0 0; line-height: 1.55; }
footer { padding: 6px 4px 24px; color: #94a3b8; font-size: .78rem; line-height: 1.7; }
@media (min-width: 700px) { main { padding: 28px; } .hero { grid-template-columns: 1fr auto; align-items: end; } .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); } .metrics.two { grid-template-columns: repeat(2, minmax(0, 1fr)); } .habitat { grid-template-columns: auto 1fr; } }
@media (min-width: 980px) { .split { grid-template-columns: 1.15fr .85fr; } .split.reverse { grid-template-columns: .78fr 1.22fr; } }
@media (max-width: 980px) { .radio-header { grid-template-columns: 1fr auto; } .radio-header nav { display: none; } .radio-hero, .radio-editor { grid-template-columns: 1fr; } .radio-player { margin: 0 24px 48px; } .radio-queue { border-right: 0; border-bottom: 1px solid #263035; } .radio-stations, .radio-market { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .radio-header { min-height: 68px; padding-inline: 18px; } .radio-status { font-size: 12px; } .radio-intro { padding: 58px 20px 40px; } .radio-intro h1 { font-size: clamp(2.7rem, 14vw, 4.25rem); } .radio-player { margin: 0 14px 34px; padding: 22px; } .radio-section, .radio-queue, .radio-script { padding: 48px 20px; } .radio-section-heading { align-items: flex-start; flex-direction: column; } .radio-stations, .radio-market { grid-template-columns: 1fr; } .radio-stations button { min-height: 132px; border-right: 1px solid #293338; } .radio-queue > button { grid-template-columns: 34px minmax(0, 1fr); } .radio-queue > button > b { display: none; } .radio-archive article { grid-template-columns: 36px minmax(0, 1fr); gap: 12px; } .radio-archive article > div { grid-template-columns: 1fr; gap: 8px; } .radio-archive article > b { display: none; } .radio-footer { grid-template-columns: 1fr; padding: 30px 20px; } }
@media (max-width: 520px) { .game-actions { flex-direction: column; } .inline { align-items: stretch; } .inline .primary { width: 100%; } }
`;

function projectFontStack(font: GeneratedProjectSpec["design"]["font"]): string {
  if (font === "ibm-plex") return '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
  if (font === "space-grotesk") return '"Space Grotesk", Inter, ui-sans-serif, system-ui, sans-serif';
  return "Inter, ui-sans-serif, system-ui, sans-serif";
}

export function projectTemplateGlobalCss(spec: GeneratedProjectSpec): string {
  return PROJECT_TEMPLATE_GLOBAL_CSS.replace(
    ':root { color-scheme: dark; --project-accent: #67e8f9; --project-surface: #070a12; --project-radius: 20px; --project-font: Inter, ui-sans-serif, system-ui, sans-serif; }',
    `:root { color-scheme: dark; --project-accent: ${spec.theme.accent}; --project-surface: ${spec.theme.surface}; --project-radius: ${spec.design.radius}px; --project-font: ${projectFontStack(spec.design.font)}; }`,
  );
}

export function projectTemplateComponentSource(
  spec: GeneratedProjectSpec,
  copy: TemplateCopy,
): string {
  const model = safeJson({
    name: spec.name,
    presetId: spec.presetId,
    eyebrow: copy.eyebrow,
    headline: copy.headline,
    description: copy.description,
    primaryAction: copy.primaryAction,
    metrics: copy.metrics,
    blocks: copy.blocks,
    modules: spec.blueprint.modules,
    emptyState: spec.blueprint.content.emptyState,
  });
  const managedImport = spec.presetId === "custom-product"
    ? 'import { useManagedCollection } from "../lib/use-managed-collection";'
    : "";
  return selectCategoryComponent(
    COMPONENT_TEMPLATE
      .replace("__PRODUCT_MODEL__", () => model)
      .replace("__MANAGED_IMPORT__", () => managedImport),
    COMPONENT_NAME_BY_PRESET[spec.presetId],
  );
}
