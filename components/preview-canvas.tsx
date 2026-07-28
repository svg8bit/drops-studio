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
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Flame,
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
  UsersRound,
  Volume2,
  Zap,
} from "lucide-react";
import type { Preset } from "@/lib/presets";
import type { GeneratedProjectSpec } from "@/lib/project-types";

export interface MarketCoin {
  symbol: string;
  name: string;
  price: string;
  change: number;
  marketCap: string;
}

export interface PredictionEvent {
  title: string;
  probability: number;
  change: number;
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

const formatSigned = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

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
        <p>{leader.name} leads your watchlist as market activity accelerates.</p>
        <button type="button" onClick={() => onAction("OPEN IN DROPSTAB")}>Open in DropsTab <ExternalLink size={13} /></button>
      </div>
      <div className="brief-block">
        <div className="brief-heading"><Clock3 size={17} /><strong>Next catalyst</strong><b>2 days</b></div>
        <p>ARB unlock and two project activities deserve attention.</p>
        <button type="button" onClick={() => onAction("SET ALERT")}>Create a Drops alert <ArrowRight size={13} /></button>
      </div>
      <div className="brief-block last">
        <div className="brief-heading"><Rocket size={17} /><strong>Fresh funding</strong><b>$18.7M</b></div>
        <p>Three projects raised in the last 24 hours.</p>
      </div>
    </div>
  );
}

function EnginePreview({ values, onAction }: { values: Record<string, string>; onAction: (label: string) => void }) {
  return (
    <div className="engine-card">
      <div className="engine-status"><span><Activity size={14} /> Signal confirmed</span><b>82 / 100</b></div>
      <h3>SOL catalyst setup</h3>
      <p className="engine-thesis">{values.signal || "Unlock + catalyst"} is now confirmed by {values.trigger || "a whale move"}.</p>
      <div className="reason-grid">
        <Metric label="WHY" value="Catalyst strength: High" positive />
        <Metric label="WHEN" value="Whale buy: $1.2M" positive />
        <Metric label="RISK" value="Unlock exposure: Low" />
      </div>
      <div className="engine-decision"><Zap size={18} /><div><span>Recommended next step</span><strong>{values.action || "Alert + trade plan"}</strong></div></div>
      <ActionRow actions={["BUY", "HEDGE", "WAIT"]} onAction={onAction} />
    </div>
  );
}

function ChannelPreview({ spec, onAction }: { spec?: GeneratedProjectSpec; onAction: (label: string) => void }) {
  return (
    <div className="telegram-card alpha-message">
      <div className="message-title">
        <span className="message-icon purple"><Zap size={17} /></span>
        <div><strong>{spec?.blueprint.content.headline ?? "Alpha caught early"}</strong><span>{spec?.values.niche ?? "Solana smart money"} · now</span></div>
        <BadgeCheck className="verified" size={17} />
      </div>
      <div className="alpha-token-row">
        <div className="token-orb">JUP</div>
        <div><strong>Jupiter</strong><span>Whale accumulation</span></div>
        <b>+7.2%</b>
      </div>
      <p className="alpha-copy">Two tracked wallets bought $428K while volume expanded 2.4×. No major unlock is scheduled in the next 14 days.</p>
      <div className="source-row"><ShieldCheck size={14} /> Sources attached · DropsTab context</div>
      <ActionRow actions={["BUY IN DROPS", "TRACK", "SHARE"]} onAction={onAction} />
      <div className="caller-note"><CircleDollarSign size={15} /> Caller revenue is enabled for this channel.</div>
    </div>
  );
}

function PredictionPreview({ market, prediction, onAction }: { market: MarketCoin[]; prediction: PredictionEvent; onAction: (label: string) => void }) {
  return (
    <div className="prediction-card">
      <div className="prediction-question"><span>POLYMARKET EVENT</span><strong>{prediction.title}</strong></div>
      <div className="odds-row">
        <div><span>YES</span><strong>{prediction.probability}¢</strong><small>{prediction.change ? `${prediction.change > 0 ? "+" : ""}${prediction.change}¢ today` : "live probability"}</small></div>
        <div className="odds-chart"><i /><i /><i /><i /><i /><i /></div>
      </div>
      <div className="impact-label">RELATED MARKET REACTION</div>
      <div className="impact-list">
        {market.slice(0, 3).map((coin, index) => (
          <div key={coin.symbol}><span>{coin.symbol}</span><div className="impact-bar"><i style={{ width: `${72 - index * 13}%` }} /></div><b>{formatSigned(Math.abs(coin.change) + 2.1)}</b></div>
        ))}
      </div>
      <div className="ai-note"><Sparkles size={16} /><p><strong>AI read:</strong> Odds moved before the broader Solana basket. Momentum remains positive, but reversal risk rises below 55¢.</p></div>
      <ActionRow actions={["TRADE MARKET", "BUY BASKET", "SET REVERSAL"]} onAction={onAction} />
    </div>
  );
}

function CopyPreview({ onAction }: { onAction: (label: string) => void }) {
  return (
    <div className="copy-card">
      <div className="copy-wallet"><div className="wallet-avatar">0x</div><div><strong>Smart Wallet 07</strong><span>Verified public address</span></div><b>88 score</b></div>
      <div className="copy-trade"><span>BOUGHT</span><strong>$84,200 JUP</strong><small>Entry $0.91 · 2 minutes ago</small></div>
      <div className="copy-checks">
        <div><BadgeCheck size={15} /> Volume confirmation</div>
        <div><BadgeCheck size={15} /> No near-term unlock</div>
        <div><BadgeCheck size={15} /> Position cap respected</div>
      </div>
      <div className="risk-limit"><span>Your planned size</span><strong>$420 · 2% max</strong></div>
      <ActionRow actions={["COPY", "PAPER TRADE", "SKIP"]} onAction={onAction} />
    </div>
  );
}

function AggregatorPreview({ market, onAction }: { market: MarketCoin[]; onAction: (label: string) => void }) {
  return (
    <div className="aggregator-card">
      <div className="aggregator-toolbar"><div><BarChart3 size={17} /><strong>PulseCap</strong></div><span>Markets</span><span>Unlocks</span><span>Funding</span></div>
      <div className="aggregator-stats"><Metric label="MARKET CAP" value="$2.48T" /><Metric label="24H VOLUME" value="$98.4B" /><Metric label="BTC DOM." value="52.8%" /></div>
      <div className="market-table">
        <div className="market-row head"><span># / Asset</span><span>Price</span><span>24h</span></div>
        {market.map((coin, index) => (
          <button className="market-row" key={coin.symbol} type="button" onClick={() => onAction(`VIEW ${coin.symbol}`)}>
            <span><i>{index + 1}</i><b>{coin.symbol}</b><small>{coin.name}</small></span>
            <strong>{coin.price}</strong>
            <em className={coin.change >= 0 ? "positive" : "negative"}>{formatSigned(coin.change)}</em>
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
      setScore((value) => value + 10 + Math.floor(Math.random() * 8));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [playing]);

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
      <div className="catcher-hud"><span><Gamepad2 /> DAILY MARKET RUN</span><div><b>{score.toLocaleString()}</b><small>SCORE</small></div><div><b>{"♥".repeat(lives)}</b><small>LIVES</small></div><strong>{seconds}s</strong></div>
      <div className="catcher-title"><span>POWERED BY DROPSTAB MOMENTUM</span><h3>{title}</h3><p>{spec?.blueprint.content.subheadline ?? "Catch market leaders. Dodge unlock risk."}</p></div>
      {playing && <div className="falling-layer" aria-hidden="true">{market.slice(0, 3).map((coin, index) => <i className={`falling-token lane-${index}`} style={{ animationDelay: `${index * -.72}s` }} key={coin.symbol}>{coin.symbol}</i>)}<i className="falling-token hazard lane-3">!</i></div>}
      <div className="catcher-character-marker" style={{ left: `${15 + lane * 23}%` }}><i /><span>{retro ? "WOLF" : "PLAYER"}</span></div>
      {!playing && seconds > 0 && <button className="catcher-start" type="button" onClick={start}><Play /> {spec?.blueprint.content.primaryAction ?? "PLAY NOW"}</button>}
      {!playing && seconds === 0 && <div className="catcher-result"><Trophy /><strong>{score} points</strong><span>Round complete · Drops Bot challenge ready</span><button type="button" onClick={start}><RotateCcw /> Play again</button></div>}
      <div className="catcher-controls"><button type="button" onClick={() => move(-1)} aria-label="Move left"><ArrowLeft /></button><span>{playing ? "Move the baskets" : "Keyboard + touch ready"}</span><button type="button" onClick={() => move(1)} aria-label="Move right"><ArrowRight /></button></div>
    </div>
  );
}

function CompanionPreview({ onAction }: { onAction: (label: string) => void }) {
  return (
    <div className="companion-card">
      <div className="companion-greeting"><Sparkles size={18} /><div><strong>For you, not for everyone</strong><span>Based on your SOL + AI interests</span></div></div>
      <div className="discovery-card"><span>BECAUSE YOU FOLLOW JUP</span><strong>Three Solana infrastructure projects are gaining volume</strong><p>One has a funding catalyst; two have low near-term unlock pressure.</p><div><button type="button" onClick={() => onAction("MORE LIKE THIS")}>More like this</button><button type="button" onClick={() => onAction("EXPLAIN")}>Explain</button></div></div>
      <div className="companion-mini"><Star size={16} /><div><strong>New topic unlocked</strong><span>AI x DePIN · 7 related assets</span></div><ArrowRight size={16} /></div>
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
      <div className="pet-header"><div><strong>Porty is thriving</strong><span>Your portfolio creature</span></div><b>82 health</b></div>
      <div className="pet-bars"><span><i style={{ width: "82%" }} />Diversification</span><span><i style={{ width: "64%" }} />Momentum</span><span className="warning"><i style={{ width: "38%" }} />Unlock risk</span></div>
      <div className="pet-message"><HeartPulse size={16} /> “SOL is carrying us today. Maybe feed me one less volatile asset?”</div>
      <ActionRow actions={["FEED", "CHECK HEALTH", "SHARE PET"]} onAction={onAction} />
    </div>
  );
}

function HuntPreview({ onAction }: { onAction: (label: string) => void }) {
  const projects = [
    { name: "OrbitKit", note: "Wallet automation for teams", votes: 482, tag: "TOOLS" },
    { name: "ProofRadio", note: "Live crypto audio intelligence", votes: 319, tag: "AI" },
    { name: "MintBase", note: "Transparent token launch studio", votes: 271, tag: "LAUNCH" },
  ];
  return (
    <div className="hunt-card">
      <div className="hunt-title"><Rocket size={18} /><div><strong>Today in crypto</strong><span>Ranked with DropsTab context</span></div><button type="button" onClick={() => onAction("SUBMIT")}>Submit</button></div>
      <div className="hunt-list">
        {projects.map((project, index) => (
          <button key={project.name} type="button" onClick={() => onAction(`OPEN ${project.name}`)}>
            <span className="hunt-rank">{index + 1}</span><div><b>{project.name}</b><small>{project.note}</small><em>{project.tag}</em></div><span className="hunt-votes"><TrendingUp size={13} />{project.votes}</span>
          </button>
        ))}
      </div>
      <div className="hunt-footer"><ListPlus size={14} /> 12 launches added today</div>
    </div>
  );
}

function RadioPreview({ isPlaying, onToggleAudio }: { isPlaying: boolean; onToggleAudio: () => void }) {
  return (
    <div className="radio-card">
      <div className="radio-live"><i /> DROPS RADIO · LIVE</div>
      <div className="radio-cover"><div className="cover-orbit one" /><div className="cover-orbit two" /><Radio size={54} /><strong>Market in 5</strong><span>AI Morning Broadcast</span></div>
      <div className="radio-now"><div><span>NOW PLAYING</span><strong>SOL leads as ETF odds jump</strong><small>Up next: today’s unlock map</small></div><button type="button" onClick={onToggleAudio} aria-label={isPlaying ? "Pause radio" : "Play radio"}>{isPlaying ? <Pause /> : <Play />}</button></div>
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
      <div className="siri-answer"><Sparkles size={16} /><p>SOL contributed most of today’s gain. ETF odds rose 26¢, while your other assets stayed inside normal ranges.</p></div>
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
        <span className="preview-ready"><BadgeCheck size={17} /> {spec ? "AI build" : preset.shortTitle} · Preview updated</span>
        <span className={`data-mode ${dataMode}`}><i /> {dataMode === "live" ? "Live DropsTab data" : "Sample data"}</span>
      </div>
      <div className={`preview-device ${surface}`} style={{ "--preview-accent": preset.accent, "--preview-tint": preset.tint } as React.CSSProperties}>
        <div className="preview-device-header">
          {isTelegram && <button className="telegram-back" type="button" aria-label="Back"><ArrowLeft /></button>}
          <div className="preview-brand-mark"><Image src="https://dropstab.com/images/dropstab-logo-drop-default.svg" alt="" width={26} height={26} unoptimized /></div>
          <div className="preview-profile"><strong>{visibleName}</strong><span>{isTelegram ? `${values.audience ?? "10,842"} subscribers · built with DropsTab` : isGame ? "Playable build · DropsTab live market adapter" : spec?.tagline ?? "Built with Drops Studio"}</span></div>
          <button type="button" aria-label="Preview options"><span /><span /><span /></button>
        </div>
        {!isTelegram && !isGame && spec && <div className="native-screen-tabs">{spec.blueprint.screens.slice(0, 4).map((screen, index) => <span className={index === 0 ? "active" : ""} key={screen}>{screen}</span>)}</div>}
        <div className="preview-stage">{content}</div>
        {isTelegram && <div className="preview-reactions"><span><Flame size={15} />128</span><span><Star size={15} />64</span><span><UsersRound size={15} />23</span><button type="button" onClick={() => onAction("SHARE")}><ArrowRight size={16} /></button></div>}
      </div>
      <p className="preview-footnote"><ShieldCheck size={14} /> Preview changes live. No key or trade is executed without your approval.</p>
    </section>
  );
}
