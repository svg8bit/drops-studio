"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeCheck,
  BarChart3,
  Clock3,
  ExternalLink,
  Gamepad2,
  HeartPulse,
  ListPlus,
  Mic2,
  Pause,
  Play,
  Radio,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Volume2,
  Zap,
} from "lucide-react";
import type { Preset } from "@/lib/presets";
import type { GeneratedProjectSpec } from "@/lib/project-types";

export interface MarketCoin {
  symbol: string;
  name: string;
  price: string;
  change: number | null;
  marketCap: string;
}

export interface PredictionEvent {
  title: string;
  probability: number | null;
  change: number | null;
  url?: string;
}

interface PreviewCanvasProps {
  preset: Preset;
  spec?: GeneratedProjectSpec;
  values: Record<string, string>;
  market: MarketCoin[];
  dataMode: "sample" | "live";
  prediction: PredictionEvent;
  isPlaying: boolean;
  onToggleAudio: () => void;
  onAction: (label: string) => void;
}

const formatSigned = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="preview-metric">
      <span>{label}</span>
      <strong className={positive ? "positive" : undefined}>{value}</strong>
    </div>
  );
}

function ActionRow({ actions, onAction }: { actions: string[]; onAction: (label: string) => void }) {
  return (
    <div className="preview-actions">
      {actions.slice(0, 3).map((action, index) => (
        <button
          key={action}
          className={index === 0 ? "preview-action primary" : "preview-action"}
          onClick={() => onAction(action)}
          type="button"
        >
          {action}
        </button>
      ))}
    </div>
  );
}

function BriefPreview({ market, spec, onAction }: { market: MarketCoin[]; spec?: GeneratedProjectSpec; onAction: (label: string) => void }) {
  const leader = market[0];
  return (
    <div className="telegram-card">
      <div className="message-title">
        <span className="message-icon sun"><TrendingUp size={17} /></span>
        <div><strong>{spec?.blueprint.content.headline ?? "Morning Alpha"}</strong><span>Today · {spec?.values.schedule ?? "08:00 UTC"}</span></div>
      </div>
      <div className="brief-block">
        <div className="brief-heading"><TrendingUp size={17} /><strong>Biggest move</strong><b>{leader.symbol} {formatSigned(leader.change)}</b></div>
        <p>{leader.change === null ? "Live percentage change is not available yet." : `${leader.name} leads your watchlist as market activity accelerates.`}</p>
        <button type="button" onClick={() => onAction("OPEN IN DROPSTAB")}>Open in DropsTab <ExternalLink size={13} /></button>
      </div>
      <div className="brief-block">
        <div className="brief-heading"><Clock3 size={17} /><strong>Next unlock</strong><b>Not connected</b></div>
        <p>Connect the DropsTab unlock endpoint before this section can show a sourced event.</p>
        <button type="button" onClick={() => onAction("CONNECT DROPSTAB")}>Open data setup <ArrowRight size={13} /></button>
      </div>
      <div className="brief-block last">
        <div className="brief-heading"><Rocket size={17} /><strong>Fresh funding</strong><b>Not connected</b></div>
        <p>No funding value is shown until a DropsTab funding response is available.</p>
      </div>
    </div>
  );
}

function EnginePreview({ values, onAction }: { values: Record<string, string>; onAction: (label: string) => void }) {
  return (
    <div className="engine-card">
      <div className="engine-status"><span><Activity size={14} /> Decision rule draft</span><b>Research mode</b></div>
      <h3>Build a sourced decision rule</h3>
      <p className="engine-thesis">Watch {values.signal || "a market catalyst"}; require {values.trigger || "a verified trigger"} before review.</p>
      <div className="reason-grid">
        <Metric label="WHY" value="Connect DropsTab evidence" />
        <Metric label="WHEN" value="Await verified trigger" />
        <Metric label="RISK" value="Set review limits" />
      </div>
      <div className="engine-decision"><Zap size={18} /><div><span>Recommended next step</span><strong>{values.action || "Alert + trade plan"}</strong></div></div>
      <ActionRow actions={["BUILD RULE", "OPEN RESEARCH", "SET ALERT"]} onAction={onAction} />
    </div>
  );
}

function ChannelPreview({ spec, onAction }: { spec?: GeneratedProjectSpec; onAction: (label: string) => void }) {
  const trackedAsset = spec?.market?.[0]?.symbol;
  return (
    <div className="telegram-card alpha-message">
      <div className="message-title">
        <span className="message-icon purple"><Zap size={17} /></span>
        <div><strong>{spec?.blueprint.content.headline ?? "Sourced alpha draft"}</strong><span>{spec?.values.niche ?? "Selected crypto niche"} · preview</span></div>
      </div>
      <div className="alpha-token-row">
        <div className="token-orb">{trackedAsset ?? "—"}</div>
        <div><strong>{trackedAsset ?? "Tracked asset"}</strong><span>{trackedAsset ? "Waiting for a verified signal" : "Awaiting asset selection"}</span></div>
        <b>—</b>
      </div>
      <p className="alpha-copy">A real post appears here after the market adapter returns data and you generate a sourced draft.</p>
      <div className="source-row"><ShieldCheck size={14} /> PREVIEW · NOT PUBLISHED</div>
      <ActionRow actions={["CONNECT CHANNEL", "OPEN DROPSTAB", "EDIT DRAFT"]} onAction={onAction} />
    </div>
  );
}

function PredictionPreview({ market, prediction, onAction }: { market: MarketCoin[]; prediction: PredictionEvent; onAction: (label: string) => void }) {
  return (
    <div className="prediction-card">
      <div className="prediction-question"><span>POLYMARKET EVENT</span><strong>{prediction.title}</strong></div>
      <div className="odds-row">
        <div><span>YES</span><strong>{prediction.probability === null ? "—" : `${prediction.probability}¢`}</strong><small>{prediction.change === null ? "Awaiting live probability" : `${prediction.change > 0 ? "+" : ""}${prediction.change}¢ today`}</small></div>
        <div className="odds-chart"><i /><i /><i /><i /><i /><i /></div>
      </div>
      <div className="impact-label">SELECTED ASSETS · HEURISTIC MAP</div>
      <div className="impact-list">
        {market.slice(0, 3).map((coin, index) => (
          <div key={coin.symbol}><span>{coin.symbol}</span><div className="impact-bar"><i style={{ width: `${72 - index * 13}%` }} /></div><b>{formatSigned(coin.change)}</b></div>
        ))}
      </div>
      <div className="ai-note"><Sparkles size={16} /><p><strong>Research note:</strong> These assets come from the selected market universe; no causal relationship or historical sensitivity is implied.</p></div>
      <ActionRow actions={["OPEN MARKET", "RESEARCH ASSETS", "SET ALERT"]} onAction={onAction} />
    </div>
  );
}

function CopyPreview({ onAction }: { onAction: (label: string) => void }) {
  return (
    <div className="copy-card">
      <div className="copy-wallet"><div className="wallet-avatar">0x</div><div><strong>Add a public wallet</strong><span>No event feed connected</span></div><b>Setup</b></div>
      <div className="copy-trade"><span>PAPER MODE</span><strong>No wallet event yet</strong><small>Add an address, then connect Drops Bot or an onchain feed.</small></div>
      <div className="copy-checks">
        <div><Clock3 size={15} /> Wallet event awaiting source</div>
        <div><Clock3 size={15} /> Unlock check awaiting DropsTab</div>
        <div><BadgeCheck size={15} /> Paper-only risk cap available</div>
      </div>
      <div className="risk-limit"><span>Your local paper rule</span><strong>2% max · no amount assumed</strong></div>
      <ActionRow actions={["ADD WALLET", "CONNECT ALERTS", "PAPER RULE"]} onAction={onAction} />
    </div>
  );
}

function AggregatorPreview({ market, onAction }: { market: MarketCoin[]; onAction: (label: string) => void }) {
  return (
    <div className="aggregator-card">
      <div className="aggregator-toolbar"><div><BarChart3 size={17} /><strong>PulseCap</strong></div><span>Markets</span><span>Unlocks</span><span>Funding</span></div>
      <div className="aggregator-stats"><Metric label="MARKET CAP" value="Connect DropsTab" /><Metric label="24H VOLUME" value="—" /><Metric label="BTC DOM." value="—" /></div>
      <div className="market-table">
        <div className="market-row head"><span># / Asset</span><span>Price</span><span>24h</span></div>
        {market.map((coin, index) => (
          <button className="market-row" key={coin.symbol} type="button" onClick={() => onAction(`VIEW ${coin.symbol}`)}>
            <span><i>{index + 1}</i><b>{coin.symbol}</b><small>{coin.name}</small></span>
            <strong>{coin.price}</strong>
            <em className={coin.change === null ? undefined : coin.change >= 0 ? "positive" : "negative"}>{formatSigned(coin.change)}</em>
          </button>
        ))}
      </div>
      <div className="powered-row">Market data powered by <strong>DropsTab</strong></div>
    </div>
  );
}

function GamePreview({ market, spec, onAction }: { market: MarketCoin[]; spec?: GeneratedProjectSpec; onAction: (label: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const [lane, setLane] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [seconds, setSeconds] = useState(30);
  const title = spec?.blueprint.content.headline ?? "Market Catcher";
  const retro = spec?.gameDirection?.artStyle === "retro-cartoon" || /волк|wolf/i.test(spec?.prompt ?? "");

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          setPlaying(false);
          return 0;
        }
        return value - 1;
      });
      setScore((value) => value + 10 + Math.max(0, Math.round(Math.abs(market[0]?.change ?? 0))));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [market, playing]);

  function start() {
    setPlaying(true);
    setScore(0);
    setLives(3);
    setSeconds(spec?.gameDirection?.roundSeconds ?? 30);
    onAction("START GAME");
  }

  function move(direction: -1 | 1) {
    setLane((value) => Math.max(0, Math.min(3, value + direction)));
    if (playing) setScore((value) => value + 4);
  }

  return (
    <div className={`catcher-game ${retro ? "retro" : ""}`} style={{ backgroundImage: retro ? "linear-gradient(rgba(28,20,18,.05), rgba(42,19,10,.2)), url('/assets/market-catcher-retro.png')" : undefined }}>
      <div className="catcher-hud"><span><Gamepad2 /> LOCAL MARKET RUN</span><div><b>{score.toLocaleString()}</b><small>LOCAL SCORE</small></div><div><b>{"♥".repeat(lives)}</b><small>LIVES</small></div><strong>{seconds}s</strong></div>
      <div className="catcher-title"><span>POWERED BY DROPSTAB MOMENTUM</span><h3>{title}</h3><p>{spec?.blueprint.content.subheadline ?? "Catch market leaders. Dodge unlock risk."}</p></div>
      {playing && <div className="falling-layer" aria-hidden="true">{market.slice(0, 3).map((coin, index) => <i className={`falling-token lane-${index}`} style={{ animationDelay: `${index * -.72}s` }} key={coin.symbol}>{coin.symbol}</i>)}<i className="falling-token hazard lane-3">!</i></div>}
      <div className="catcher-character-marker" style={{ left: `${15 + lane * 23}%` }}><i /><span>{retro ? "WOLF" : "PLAYER"}</span></div>
      {!playing && seconds > 0 && <button className="catcher-start" type="button" onClick={start}><Play /> {spec?.blueprint.content.primaryAction ?? "PLAY NOW"}</button>}
      {!playing && seconds === 0 && <div className="catcher-result"><Trophy /><strong>{score} points</strong><span>Local score · this preview session only</span><button type="button" onClick={start}><RotateCcw /> Play again</button></div>}
      <div className="catcher-controls"><button type="button" onClick={() => move(-1)} aria-label="Move left"><ArrowLeft /></button><span>{playing ? "Move the baskets" : "Keyboard + touch ready"}</span><button type="button" onClick={() => move(1)} aria-label="Move right"><ArrowRight /></button></div>
    </div>
  );
}

function CompanionPreview({ onAction }: { onAction: (label: string) => void }) {
  return (
    <div className="companion-card">
      <div className="companion-greeting"><Sparkles size={18} /><div><strong>Build your local taste graph</strong><span>No interests or portfolio are assumed</span></div></div>
      <div className="discovery-card"><span>STARTER MARKET CONTEXT</span><strong>Choose assets and topics to change this ranking</strong><p>Likes and dismissals stay in this browser. Connected DropsTab categories and AI explanations are added only after setup.</p><div><button type="button" onClick={() => onAction("CHOOSE INTERESTS")}>Choose interests</button><button type="button" onClick={() => onAction("OPEN DROPSTAB")}>Open research</button></div></div>
      <div className="companion-mini"><Star size={16} /><div><strong>Preference memory</strong><span>Local only · resettable</span></div><ArrowRight size={16} /></div>
    </div>
  );
}

function TamagotchiPreview({ onAction }: { onAction: (label: string) => void }) {
  return (
    <div className="tamagotchi-card">
      <div className="pet-room">
        <div className="pet-sun" />
        <div className="pet-body"><span className="pet-eye left" /><span className="pet-eye right" /><span className="pet-mouth" /></div>
        <div className="pet-shadow" />
      </div>
      <div className="pet-header"><div><strong>Waiting to hatch</strong><span>Enter holdings to calculate health</span></div><b>0 health</b></div>
      <div className="pet-bars"><span><i style={{ width: "0%" }} />Diversification</span><span><i style={{ width: "0%" }} />Momentum</span><span className="warning"><i style={{ width: "0%" }} />Concentration</span></div>
      <div className="pet-message"><HeartPulse size={16} /> No wallet is assumed. Health appears only after you add portfolio weights.</div>
      <ActionRow actions={["ADD HOLDINGS", "CALCULATE", "ALERT SETUP"]} onAction={onAction} />
    </div>
  );
}

function HuntPreview({ onAction }: { onAction: (label: string) => void }) {
  return (
    <div className="hunt-card">
      <div className="hunt-title"><Rocket size={18} /><div><strong>Your private launch board</strong><span>Local drafts · no public community yet</span></div><button type="button" onClick={() => onAction("ADD LOCAL DRAFT")}>Add draft</button></div>
      <div className="hunt-list"><button type="button" onClick={() => onAction("ADD LOCAL DRAFT")}><span className="hunt-rank">+</span><div><b>No saved launches</b><small>Add a product, then verify its DropsTab context.</small><em>LOCAL</em></div></button></div>
      <div className="hunt-footer"><ListPlus size={14} /> Public voting requires auth and a database</div>
    </div>
  );
}

function RadioPreview({ isPlaying, onToggleAudio }: { isPlaying: boolean; onToggleAudio: () => void }) {
  return (
    <div className="radio-card">
      <div className="radio-live"><i /> BROWSER AUDIO PREVIEW</div>
      <div className="radio-cover"><div className="cover-orbit one" /><div className="cover-orbit two" /><Radio size={54} /><strong>Market in 5</strong><span>Browser Audio Brief</span></div>
      <div className="radio-now"><div><span>{isPlaying ? "BROWSER SPEECH" : "READY"}</span><strong>Current market snapshot rundown</strong><small>Unlocks appear only after DropsTab connection</small></div><button type="button" onClick={onToggleAudio} aria-label={isPlaying ? "Pause audio" : "Play audio"}>{isPlaying ? <Pause /> : <Play />}</button></div>
      <div className={`waveform ${isPlaying ? "playing" : ""}`}>{Array.from({ length: 22 }).map((_, index) => <i key={index} style={{ height: `${12 + ((index * 17) % 27)}px` }} />)}</div>
      <div className="radio-footer"><Volume2 size={15} /> Generated from live DropsTab intelligence</div>
    </div>
  );
}

function SiriPreview({ isPlaying, onToggleAudio, onAction }: { isPlaying: boolean; onToggleAudio: () => void; onAction: (label: string) => void }) {
  return (
    <div className="siri-card">
      <div className="siri-orb"><span /><span /><span /><AudioLines size={48} /></div>
      <span className="siri-label">ASK DROPS</span>
      <h3>“What moved my portfolio today?”</h3>
      <div className="siri-answer"><Sparkles size={16} /><p>Add holdings or ask about an available market asset. No portfolio is assumed in this preview.</p></div>
      <div className="siri-suggestions"><button type="button" onClick={() => onAction("CREATE ALERT")}>Alert me on reversal</button><button type="button" onClick={() => onAction("OPEN DROPSTAB")}>Show the data</button></div>
      <button className={`mic-button ${isPlaying ? "listening" : ""}`} type="button" onClick={onToggleAudio}><Mic2 size={20} />{isPlaying ? "Listening…" : "Hold to ask"}</button>
    </div>
  );
}

export function PreviewCanvas({ preset, spec, values, market, dataMode, prediction, isPlaying, onToggleAudio, onAction }: PreviewCanvasProps) {
  let content;
  switch (preset.preview) {
    case "engine": content = <EnginePreview values={values} onAction={onAction} />; break;
    case "channel": content = <ChannelPreview spec={spec} onAction={onAction} />; break;
    case "brief": content = <BriefPreview market={market} spec={spec} onAction={onAction} />; break;
    case "prediction": content = <PredictionPreview market={market} prediction={prediction} onAction={onAction} />; break;
    case "copy": content = <CopyPreview onAction={onAction} />; break;
    case "aggregator": content = <AggregatorPreview market={market} onAction={onAction} />; break;
    case "game": content = <GamePreview market={market} spec={spec} onAction={onAction} />; break;
    case "companion": content = <CompanionPreview onAction={onAction} />; break;
    case "tamagotchi": content = <TamagotchiPreview onAction={onAction} />; break;
    case "hunt": content = <HuntPreview onAction={onAction} />; break;
    case "radio": content = <RadioPreview isPlaying={isPlaying} onToggleAudio={onToggleAudio} />; break;
    case "siri": content = <SiriPreview isPlaying={isPlaying} onToggleAudio={onToggleAudio} onAction={onAction} />; break;
    default: content = null;
  }

  const isTelegram = preset.preview === "channel" || preset.preview === "brief";
  const isGame = preset.preview === "game";
  const surface = isTelegram ? "telegram-native" : isGame ? "game-native" : `${preset.preview}-native`;
  const visibleName = spec?.name ?? (isTelegram ? preset.preview === "brief" ? "Morning Alpha" : "Alpha Channel" : preset.output);

  return (
    <section className="preview-column" aria-live="polite">
      <div className="preview-status-row">
        <span className="preview-ready"><BadgeCheck size={17} /> {spec ? "Product plan" : preset.shortTitle} · Concept preview</span>
        <span className={`data-mode ${dataMode}`}><i /> {dataMode === "live" ? "Live DropsTab data" : "Sample data"}</span>
      </div>
      <div className={`preview-device ${surface}`} style={{ "--preview-accent": preset.accent, "--preview-tint": preset.tint } as React.CSSProperties}>
        <div className="preview-device-header">
          {isTelegram && <span className="telegram-back" aria-hidden="true"><ArrowLeft /></span>}
          <div className="preview-brand-mark"><Image src="https://dropstab.com/images/dropstab-logo-drop-default.svg" alt="" width={26} height={26} unoptimized /></div>
          <div className="preview-profile"><strong>{visibleName}</strong><span>{isTelegram ? "PREVIEW · NOT PUBLISHED · built with DropsTab" : isGame ? "Playable local build · market-data adapter" : spec?.tagline ?? "Built with Drops Studio"}</span></div>
          <span className="preview-options" aria-hidden="true"><span /><span /><span /></span>
        </div>
        {!isTelegram && !isGame && spec && <div className="native-screen-tabs">{spec.blueprint.screens.slice(0, 4).map((screen, index) => <span className={index === 0 ? "active" : ""} key={screen}>{screen}</span>)}</div>}
        <div className="preview-stage">{content}</div>
        {isTelegram && <div className="preview-reactions"><span><ShieldCheck size={15} /> Faithful layout preview</span><button type="button" onClick={() => onAction("CONNECT REAL CHANNEL")}><ArrowRight size={16} /></button></div>}
      </div>
      <p className="preview-footnote"><ShieldCheck size={14} /> Concept preview only. Real data, delivery and public state are labelled separately.</p>
    </section>
  );
}
