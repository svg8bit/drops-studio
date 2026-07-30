"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeCheck,
  BarChart3,
  Clock3,
  Gamepad2,
  HeartPulse,
  ListPlus,
  Mic2,
  Pause,
  Play,
  Radio,
  Rocket,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  Volume2,
  Zap,
} from "lucide-react";
import type { MarketCoin, PredictionEvent } from "@/components/preview-canvas";
import type { Preset } from "@/lib/presets";
import type { GeneratedProjectSpec } from "@/lib/project-types";

interface PreviewVariantsProps {
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

const formatSigned = (value: number | null) =>
  value === null
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const CHANNEL_SAMPLE_PROFILES: Record<string, MarketCoin> = {
  "Solana smart money": {
    symbol: "SOL",
    name: "Solana",
    price: "$171.35",
    change: 2.31,
    marketCap: "$81B",
  },
  "AI tokens": {
    symbol: "TAO",
    name: "Bittensor",
    price: "$347.20",
    change: 6.4,
    marketCap: "$3.3B",
  },
  "Token launches": {
    symbol: "JUP",
    name: "Jupiter",
    price: "$1.12",
    change: 7.2,
    marketCap: "$3.4B",
  },
  "Polymarket alpha": {
    symbol: "BTC",
    name: "Bitcoin",
    price: "$68,432.21",
    change: 4.21,
    marketCap: "$1.35T",
  },
};

function Metric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="preview-metric">
      <span>{label}</span>
      <strong className={positive ? "positive" : undefined}>{value}</strong>
    </div>
  );
}

function ActionRow({
  actions,
  onAction,
}: {
  actions: string[];
  onAction: (label: string) => void;
}) {
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

function EnginePreview({
  values,
  onAction,
}: {
  values: Record<string, string>;
  onAction: (label: string) => void;
}) {
  const signal = values.signal || "Unlock + catalyst";
  const trigger = values.trigger || "Whale move confirms";
  const brain = values.brain || "Free Auto";
  const action = values.action || "Alert + trade plan";
  const primaryAction =
    action === "Buy token"
      ? "PREPARE BUY"
      : action === "Build basket"
        ? "BUILD BASKET"
        : action === "Hedge + monitor"
          ? "PREPARE HEDGE"
          : "REVIEW PLAN";
  const riskBoundary =
    action === "Buy token"
      ? "Approval required before execution"
      : action === "Hedge + monitor"
        ? "Monitor both sides"
        : "Research-only until approved";

  return (
    <div className="engine-card">
      <div className="engine-status">
        <span>
          <Activity size={14} /> Decision rule draft
        </span>
        <b data-preview-field="brain">{brain}</b>
      </div>
      <h3>Build a sourced decision rule</h3>
      <p className="engine-thesis">
        Watch <strong data-preview-field="signal">{signal}</strong>; require{" "}
        <strong data-preview-field="trigger">{trigger}</strong> before review.
      </p>
      <div className="reason-grid">
        <Metric label="WHY" value={signal} />
        <Metric label="WHEN" value={trigger} />
        <Metric label="RISK" value={riskBoundary} />
      </div>
      <div className="engine-decision">
        <Zap size={18} />
        <div>
          <span>Recommended next step</span>
          <strong data-preview-field="action">{action}</strong>
        </div>
      </div>
      <ActionRow
        actions={[primaryAction, "OPEN RESEARCH", "SET ALERT"]}
        onAction={onAction}
      />
    </div>
  );
}

function ChannelPreview({
  spec,
  values,
  market,
  dataMode,
  onAction,
}: {
  spec?: GeneratedProjectSpec;
  values: Record<string, string>;
  market: MarketCoin[];
  dataMode: "sample" | "live";
  onAction: (label: string) => void;
}) {
  const niche = values.niche || "Solana smart money";
  const sources = values.sources || "Wallets + swaps";
  const voice = values.voice || "Sharp & sourced";
  const earn = values.earn || "Free growth";
  const requestedAsset = spec?.market?.[0]?.symbol ?? market[0]?.symbol;
  const liveCoin =
    market.find((coin) => coin.symbol === requestedAsset) ?? market[0];
  const trackedCoin =
    dataMode === "sample"
      ? CHANNEL_SAMPLE_PROFILES[niche] ??
        CHANNEL_SAMPLE_PROFILES["Solana smart money"]
      : liveCoin;
  const trackedAsset = trackedCoin?.symbol;
  const changeLabel = formatSigned(trackedCoin?.change ?? null);
  const eventCopy = trackedAsset
    ? dataMode === "sample"
      ? `${trackedCoin.name} is ${changeLabel} in this clearly labelled sample. ${sources} triggered the draft; connect live sources before publishing.`
      : trackedCoin.change === null
        ? `The ${trackedCoin.name} event is connected, but its verified price change is not available yet.`
        : `${trackedCoin.name} is ${changeLabel}. ${sources} triggered this draft for source review before publishing.`
    : "Choose an asset and connect a source to create the first reviewable draft.";
  const voiceCopy =
    voice === "Degen but honest"
      ? `${eventCopy} The uncertainty and risk boundary stay attached before anyone apes.`
      : voice === "Institutional"
        ? `${eventCopy} Publication remains blocked until the source and market context are verified.`
        : voice === "My custom prompt"
          ? "Your custom editorial instructions will shape this post after you add them in the Director."
          : eventCopy;
  const goalCopy =
    earn === "Caller-link plan"
      ? "Revenue goal · caller links require disclosure and an approved destination"
      : earn === "Paid-channel plan"
        ? "Revenue goal · paid access requires auth and billing"
        : earn === "Sponsor-slot plan"
          ? "Revenue goal · sponsor slots stay clearly labelled"
          : "Growth goal · free public distribution";
  const signalTitle = trackedAsset
    ? `${trackedAsset} signal caught early`
    : "Your first sourced post";

  return (
    <div className="telegram-card alpha-message">
      <div className="message-title">
        <span className="message-icon purple">
          <Zap size={17} />
        </span>
        <div>
          <strong>{signalTitle}</strong>
          <span data-preview-field="niche">{niche} · now</span>
        </div>
      </div>
      <div className="alpha-token-row">
        <div className="token-orb">{trackedAsset ?? "—"}</div>
        <div>
          <strong>{trackedAsset ?? "Tracked asset"}</strong>
          <span>
            {trackedAsset
              ? `${trackedCoin?.name ?? trackedAsset} · ${trackedCoin?.price ?? "price unavailable"}`
              : "Awaiting asset selection"}
          </span>
        </div>
        <b>{changeLabel}</b>
      </div>
      <p className="alpha-copy" data-preview-field="voice">
        <strong>{voice}:</strong> {voiceCopy}
      </p>
      <button
        className="telegram-source-link"
        onClick={() => onAction("OPEN IN DROPSTAB")}
        type="button"
      >
        View research on DropsTab <ArrowRight size={15} />
      </button>
      <div className="source-row" data-preview-field="sources">
        <Image
          src="/brand/dropstab-mark.svg"
          alt="DropsTab"
          width={32}
          height={32}
          unoptimized
        />
        {dataMode === "sample"
          ? `${sources} · sample DropsTab format`
          : `${sources} · DropsTab context attached`}
      </div>
      <div className="caller-note" data-preview-field="earn">
        <Rocket size={14} /> <strong>{earn}</strong> · {goalCopy}
      </div>
      <span className="telegram-draft-state">
        {dataMode === "sample" ? "SAMPLE DRAFT" : "PREVIEW"} · NOT PUBLISHED
      </span>
    </div>
  );
}

function PredictionPreview({
  values,
  market,
  prediction,
  onAction,
}: {
  values: Record<string, string>;
  market: MarketCoin[];
  prediction: PredictionEvent;
  onAction: (label: string) => void;
}) {
  const event = values.event || "SOL ETF approval";
  const trigger = values.trigger || "+15¢ probability";
  const impact = values.impact || "Tokens + category";
  const action = values.action || "Trade + hedge";
  const eventTitle =
    event === "Paste Polymarket URL" ? prediction.title : event;
  const impactCount =
    impact === "Only majors" ? 2 : impact === "Full ecosystem" ? 4 : 3;
  const primaryAction =
    action === "Alert only"
      ? "CREATE ALERT"
      : action === "Build basket"
        ? "BUILD BASKET"
        : action === "Reversal strategy"
          ? "SET REVERSAL"
          : "PREPARE PLAN";

  return (
    <div className="prediction-card">
      <div className="prediction-question">
        <span data-preview-field="event">POLYMARKET EVENT · {event}</span>
        <strong>{eventTitle}</strong>
      </div>
      <div className="odds-row">
        <div>
          <span>YES</span>
          <strong>
            {prediction.probability === null
              ? "—"
              : `${prediction.probability}¢`}
          </strong>
          <small>
            {prediction.change === null
              ? "Awaiting live probability"
              : `${prediction.change > 0 ? "+" : ""}${prediction.change}¢ today`}
          </small>
        </div>
        <div className="odds-chart">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="impact-label" data-preview-field="impact">
        {impact} · HEURISTIC MAP
      </div>
      <div className="impact-list">
        {market.slice(0, impactCount).map((coin, index) => (
          <div key={coin.symbol}>
            <span>{coin.symbol}</span>
            <div className="impact-bar">
              <i style={{ width: `${72 - index * 13}%` }} />
            </div>
            <b>{formatSigned(coin.change)}</b>
          </div>
        ))}
      </div>
      <div className="ai-note">
        <Sparkles size={16} />
        <p>
          <strong data-preview-field="trigger">Trigger · {trigger}.</strong>{" "}
          These assets come from the selected market universe; no causal
          relationship or historical sensitivity is implied.
        </p>
      </div>
      <div className="risk-limit">
        <span>Selected response</span>
        <strong data-preview-field="action">{action}</strong>
      </div>
      <ActionRow
        actions={[primaryAction, "OPEN MARKET", "RESEARCH ASSETS"]}
        onAction={onAction}
      />
    </div>
  );
}

function CopyPreview({
  values,
  onAction,
}: {
  values: Record<string, string>;
  onAction: (label: string) => void;
}) {
  const wallets = values.wallets || "Add addresses";
  const confirm = values.confirm || "Volume + price";
  const size = values.size || "2% per position";
  const execute = values.execute || "Paper trade";
  const executeAction =
    execute === "Telegram alert"
      ? "CONNECT TELEGRAM"
      : execute === "Approval plan"
        ? "BUILD APPROVAL FLOW"
        : execute === "Research only"
          ? "OPEN RESEARCH"
          : "CREATE PAPER RULE";

  return (
    <div className="copy-card">
      <div className="copy-wallet">
        <div className="wallet-avatar">0x</div>
        <div>
          <strong data-preview-field="wallets">{wallets}</strong>
          <span>No event feed connected</span>
        </div>
        <b>Setup</b>
      </div>
      <div className="copy-trade">
        <span data-preview-field="execute">{execute} mode</span>
        <strong>No wallet event yet</strong>
        <small>Add an address, then connect Drops Bot or an onchain feed.</small>
      </div>
      <div className="copy-checks">
        <div>
          <Clock3 size={15} /> Wallet event awaiting source
        </div>
        <div>
          <Clock3 size={15} /> Confirmation ·{" "}
          <strong data-preview-field="confirm">{confirm}</strong>
        </div>
        <div>
          <BadgeCheck size={15} /> Paper-only risk cap available
        </div>
      </div>
      <div className="risk-limit">
        <span>Your local risk rule</span>
        <strong data-preview-field="size">{size} · no amount assumed</strong>
      </div>
      <ActionRow
        actions={[executeAction, "ADD WALLET", "CONNECT ALERTS"]}
        onAction={onAction}
      />
    </div>
  );
}

function AggregatorPreview({
  values,
  market,
  onAction,
}: {
  values: Record<string, string>;
  market: MarketCoin[];
  onAction: (label: string) => void;
}) {
  const universe = values.universe || "Top 100 coins";
  const ranking = values.ranking || "Market cap";
  const modules = values.modules || "Markets + unlocks";
  const publish = values.publish || "Public live page";
  const visibleModules =
    modules === "Markets only"
      ? ["Markets"]
      : modules === "Funding + investors"
        ? ["Funding", "Investors"]
        : modules === "Full research"
          ? ["Markets", "Unlocks", "Funding"]
          : ["Markets", "Unlocks"];
  const rankedMarket = [...market].sort((left, right) => {
    if (ranking === "24h movers") {
      return Math.abs(right.change ?? -Infinity) - Math.abs(left.change ?? -Infinity);
    }
    return 0;
  });
  const rankingStatus =
    ranking === "Volume"
      ? "Volume order activates when DropsTab volume is available"
      : ranking === "FDV gap"
        ? "FDV gap order activates when FDV is available"
        : `${ranking} ranking active`;
  const publishAction =
    publish === "Private dashboard"
      ? "PREVIEW PRIVATE"
      : publish === "Embeddable widget"
        ? "PREVIEW EMBED"
        : publish === "Telegram mini app"
          ? "SET UP MINI APP"
          : "PREVIEW PUBLIC PAGE";

  return (
    <div className="aggregator-card">
      <div className="aggregator-toolbar">
        <div>
          <BarChart3 size={17} />
          <strong>PulseCap</strong>
        </div>
        {visibleModules.map((module) => (
          <span key={module}>{module}</span>
        ))}
      </div>
      <div className="aggregator-stats">
        <Metric label="UNIVERSE" value={universe} />
        <Metric label="RANKING" value={ranking} />
        <Metric label="MODULES" value={modules} />
      </div>
      <div className="aggregator-native-status">
        <span data-preview-field="universe">{universe}</span>
        <strong data-preview-field="ranking">{rankingStatus}</strong>
        <em data-preview-field="modules">{modules}</em>
      </div>
      {modules === "Funding + investors" ? (
        <div className="aggregator-empty-module" data-preview-field="modules">
          <Rocket size={20} />
          <strong>{modules}</strong>
          <span>Connect funding rounds to populate this research module.</span>
        </div>
      ) : (
        <div className="market-table" data-preview-field="modules">
          <div className="market-row head">
            <span># / Asset</span>
            <span>Price</span>
            <span>24h</span>
          </div>
          {rankedMarket.map((coin, index) => (
            <button
              className="market-row"
              key={coin.symbol}
              type="button"
              onClick={() => onAction(`VIEW ${coin.symbol}`)}
            >
              <span>
                <i>{index + 1}</i>
                <b>{coin.symbol}</b>
                <small>{coin.name}</small>
              </span>
              <strong>{coin.price}</strong>
              <em
                className={
                  coin.change === null
                    ? undefined
                    : coin.change >= 0
                      ? "positive"
                      : "negative"
                }
              >
                {formatSigned(coin.change)}
              </em>
            </button>
          ))}
        </div>
      )}
      <div className="powered-row">
        <span data-preview-field="publish">Target · {publish}</span>
        <strong>
          <Image
            src="/brand/dropstab-mark.svg"
            alt="DropsTab"
            width={32}
            height={32}
            unoptimized
          />
          Market data powered by DropsTab
        </strong>
      </div>
      <ActionRow actions={[publishAction]} onAction={onAction} />
    </div>
  );
}

function GamePreview({
  values,
  market,
  spec,
  onAction,
}: {
  values: Record<string, string>;
  market: MarketCoin[];
  spec?: GeneratedProjectSpec;
  onAction: (label: string) => void;
}) {
  const selectedGame = values.game || "Unlock Dodge";
  const selectedAssets = values.assets || "Top 20";
  const selectedRound = values.round || "24 hours";
  const selectedSocial = values.social || "Leaderboard + share";
  const genre =
    selectedGame === "Beat the Market"
      ? "market-race"
      : selectedGame === "Guess the Coin"
        ? "coin-quiz"
        : selectedGame === "Portfolio Battle"
          ? "portfolio-battle"
          : "unlock-dodge";
  const localRoundSeconds =
    selectedRound === "5 minutes"
      ? 15
      : selectedRound === "1 hour"
        ? 20
        : selectedRound === "7 days"
          ? 45
          : 30;
  const [playing, setPlaying] = useState(false);
  const [lane, setLane] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gamePicks, setGamePicks] = useState<string[]>([]);
  const [gameResult, setGameResult] = useState("");
  const [seconds, setSeconds] = useState(() => localRoundSeconds);
  const gameRef = useRef<HTMLDivElement>(null);
  const marketRef = useRef(market);
  const title = spec?.blueprint.content.headline ?? "Market Catcher";
  const retro =
    spec?.gameDirection?.artStyle === "retro-cartoon" ||
    /волк|wolf/i.test(spec?.prompt ?? "");
  const displayedSeconds = !playing && seconds > 0 ? localRoundSeconds : seconds;

  useEffect(() => {
    marketRef.current = market;
  }, [market]);

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
      setScore(
        (value) =>
          value +
          10 +
          Math.max(
            0,
            Math.round(Math.abs(marketRef.current[0]?.change ?? 0)),
          ),
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [playing]);

  function start() {
    setPlaying(true);
    setScore(0);
    setLives(3);
    setSeconds(localRoundSeconds);
    gameRef.current?.focus();
    onAction("START GAME");
  }

  const move = useCallback((direction: -1 | 1) => {
    setLane((value) => Math.max(0, Math.min(3, value + direction)));
    if (playing) setScore((value) => value + 4);
  }, [playing]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    };
    game.addEventListener("keydown", handleKeyDown);
    return () => game.removeEventListener("keydown", handleKeyDown);
  }, [move]);

  if (genre !== "unlock-dodge") {
    const choices = market.slice(0, genre === "portfolio-battle" ? 4 : 3);
    const heading =
      genre === "coin-quiz"
        ? "Which coin matches the clue?"
        : genre === "portfolio-battle"
          ? "Draft two assets for battle"
          : "Run the live-market race";
    const description =
      genre === "coin-quiz"
        ? `Price ${choices[0]?.price ?? "unavailable"} · 24h ${formatSigned(choices[0]?.change ?? null)}`
        : genre === "portfolio-battle"
          ? "Compare two selected assets using the current market snapshot."
          : "The available 24h movement decides this local round.";

    function choose(symbol: string) {
      if (genre === "coin-quiz") {
        const correct = symbol === choices[0]?.symbol;
        setGamePicks([symbol]);
        setScore((value) => value + (correct ? 100 : 0));
        setGameResult(
          correct
            ? `Correct — ${symbol} matches the sourced clue.`
            : `The sourced answer was ${choices[0]?.symbol ?? "unavailable"}.`,
        );
        onAction("ANSWER QUIZ");
        return;
      }
      if (genre === "portfolio-battle") {
        setGamePicks((current) =>
          current.includes(symbol)
            ? current.filter((item) => item !== symbol)
            : [...current, symbol].slice(-2),
        );
      }
    }

    function runRound() {
      if (genre === "market-race") {
        const sourced = choices
          .filter((coin) => coin.change !== null)
          .sort((left, right) => (right.change ?? 0) - (left.change ?? 0));
        setGameResult(
          sourced[0]
            ? `${sourced[0].symbol} leads this snapshot at ${formatSigned(sourced[0].change)}.`
            : "Waiting for live percentage-change data.",
        );
        if (sourced[0]) setScore((value) => value + 100);
        onAction("RUN MARKET RACE");
        return;
      }
      if (genre === "portfolio-battle") {
        if (gamePicks.length !== 2) {
          setGameResult("Select exactly two assets first.");
          return;
        }
        const drafted = gamePicks
          .map((symbol) => choices.find((coin) => coin.symbol === symbol))
          .filter((coin): coin is MarketCoin => Boolean(coin));
        const winner = drafted
          .filter((coin) => coin.change !== null)
          .sort((left, right) => (right.change ?? 0) - (left.change ?? 0))[0];
        setGameResult(
          winner
            ? `${winner.symbol} wins this snapshot at ${formatSigned(winner.change)}.`
            : "Waiting for movement data for both drafted assets.",
        );
        onAction("RESOLVE BATTLE");
      }
    }

    return (
      <div
        className={`preview-game-native ${genre}`}
        data-preview-game-genre={genre}
      >
        <header>
          <span data-preview-field="game">
            <Gamepad2 /> {selectedGame}
          </span>
          <b>{score.toLocaleString()} pts</b>
          <b data-preview-field="round">{selectedRound}</b>
        </header>
        <main>
          <span className="preview-game-kicker" data-preview-field="assets">
            {selectedAssets}
          </span>
          <h3>{heading}</h3>
          <p>{description}</p>
          <div className="preview-game-choices">
            {choices.map((coin) => (
              <button
                className={gamePicks.includes(coin.symbol) ? "active" : ""}
                key={coin.symbol}
                onClick={() => choose(coin.symbol)}
                type="button"
              >
                <span>{coin.name}</span>
                <strong>{coin.symbol}</strong>
                <small>{formatSigned(coin.change)}</small>
              </button>
            ))}
          </div>
          {gameResult && <div className="preview-game-result">{gameResult}</div>}
          {genre !== "coin-quiz" && (
            <button
              className="preview-game-run"
              onClick={runRound}
              type="button"
            >
              {genre === "market-race" ? "Run market race" : "Resolve battle"}
            </button>
          )}
        </main>
        <footer data-preview-field="social">{selectedSocial}</footer>
      </div>
    );
  }

  return (
    <div
      ref={gameRef}
      className={`catcher-game ${retro ? "retro" : ""}`}
      data-preview-game-genre="unlock-dodge"
      tabIndex={0}
      aria-label="Playable market catcher game. Use left and right arrow keys or the on-screen controls."
      style={{
        backgroundImage: retro
          ? "linear-gradient(rgba(28,20,18,.05), rgba(42,19,10,.2)), url('/assets/market-catcher-retro.png')"
          : undefined,
      }}
    >
      <div className="catcher-hud">
        <span data-preview-field="game">
          <Gamepad2 /> {selectedGame}
        </span>
        <div>
          <b>{score.toLocaleString()}</b>
          <small>LOCAL SCORE</small>
        </div>
        <div>
          <b>{"♥".repeat(lives)}</b>
          <small>LIVES</small>
        </div>
        <div data-preview-field="round">
          <b>{displayedSeconds}s</b>
          <small>{selectedRound}</small>
        </div>
      </div>
      <div className="catcher-title">
        <span data-preview-field="assets">
          {selectedAssets} · DROPSTAB MOMENTUM
        </span>
        <h3>{title}</h3>
        <p>
          {spec?.blueprint.content.subheadline ??
            "Catch market leaders. Dodge unlock risk."}
        </p>
      </div>
      {playing && (
        <div className="falling-layer" aria-hidden="true">
          {market.slice(0, 3).map((coin, index) => (
            <i
              className={`falling-token lane-${index}`}
              style={{ animationDelay: `${index * -0.72}s` }}
              key={coin.symbol}
            >
              {coin.symbol}
            </i>
          ))}
          <i className="falling-token hazard lane-3">!</i>
        </div>
      )}
      <div
        className="catcher-character-marker"
        style={{ left: `${15 + lane * 23}%` }}
      >
        <i />
        <span>{retro ? "WOLF" : "PLAYER"}</span>
      </div>
      {!playing && displayedSeconds > 0 && (
        <button className="catcher-start" type="button" onClick={start}>
          <Play /> {spec?.blueprint.content.primaryAction ?? "PLAY NOW"}
        </button>
      )}
      {!playing && displayedSeconds === 0 && (
        <div className="catcher-result">
          <Trophy />
          <strong>{score} points</strong>
          <span>Local score · this preview session only</span>
          <button type="button" onClick={start}>
            <RotateCcw /> Play again
          </button>
        </div>
      )}
      <div className="catcher-controls">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Move left"
        >
          <ArrowLeft />
        </button>
        <span data-preview-field="social">
          {playing ? "Move the baskets" : selectedSocial}
        </span>
        <button
          type="button"
          onClick={() => move(1)}
          aria-label="Move right"
        >
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

function CompanionPreview({
  values,
  onAction,
}: {
  values: Record<string, string>;
  onAction: (label: string) => void;
}) {
  const profile = values.profile || "Balanced explorer";
  const learn = values.learn || "Manual topics";
  const discover = values.discover || "Related themes";
  const brain = values.brain || "Free Auto";
  const discoveryCopy =
    discover === "Hidden gems"
      ? "Rank smaller related assets only after liquidity and source coverage are available."
      : discover === "Safer alternatives"
        ? "Compare related assets by risk context without presenting a recommendation."
        : discover === "Upcoming catalysts"
          ? "Build a queue from sourced unlock, funding and activity events after connection."
          : "Build a transparent theme graph from selected assets, categories and local feedback.";
  const learningCopy =
    learn === "Local likes + clicks"
      ? "Learns from resettable activity stored in this browser"
      : learn === "Imported watchlist"
        ? "Waits for a watchlist import before personalizing"
        : learn === "Connected data"
          ? "Uses only the data sources you explicitly connect"
          : "Starts from topics you choose manually";

  return (
    <div className="companion-card">
      <div className="companion-greeting">
        <Sparkles size={18} />
        <div>
          <strong data-preview-field="profile">{profile}</strong>
          <span data-preview-field="learn">{learn} · {learningCopy}</span>
        </div>
      </div>
      <div className="discovery-card">
        <span>PERSONAL DISCOVERY QUEUE</span>
        <strong data-preview-field="discover">{discover}</strong>
        <p>{discoveryCopy}</p>
        <div>
          <button type="button" onClick={() => onAction("CHOOSE INTERESTS")}>
            Choose interests
          </button>
          <button type="button" onClick={() => onAction("OPEN DROPSTAB")}>
            Open research
          </button>
        </div>
      </div>
      <div className="companion-mini">
        <Star size={16} />
        <div>
          <strong data-preview-field="brain">{brain}</strong>
          <span>Local preference memory · resettable</span>
        </div>
        <ArrowRight size={16} />
      </div>
    </div>
  );
}

function TamagotchiPreview({
  values,
  onAction,
}: {
  values: Record<string, string>;
  onAction: (label: string) => void;
}) {
  const portfolio = values.portfolio || "Enter holdings";
  const personality = values.personality || "Calm quant";
  const health = values.health || "Movement + diversification";
  const care = values.care || "Daily";
  const portfolioAction =
    portfolio === "Import CSV later"
      ? "IMPORT CSV"
      : portfolio === "Connect wallet later"
        ? "PLAN WALLET CONNECT"
        : portfolio === "DropsTab watchlist later"
          ? "PLAN WATCHLIST IMPORT"
          : "ADD HOLDINGS";
  const careCopy =
    care === "Morning"
      ? "Morning check-in prepared"
      : care === "On big moves"
        ? "Checks only after a sourced large move"
        : care === "When it gets sick"
          ? "Checks after the selected health rule deteriorates"
          : "Daily check-in prepared";

  return (
    <div className="tamagotchi-card">
      <div className="pet-room">
        <div className="pet-sun" />
        <div className="pet-body">
          <span className="pet-eye left" />
          <span className="pet-eye right" />
          <span className="pet-mouth" />
        </div>
        <div className="pet-shadow" />
      </div>
      <div className="pet-header">
        <div>
          <strong data-preview-field="personality">{personality}</strong>
          <span data-preview-field="portfolio">{portfolio} to hatch</span>
        </div>
        <b>0 health</b>
      </div>
      <div className="pet-health-model" data-preview-field="health">
        Health model · <strong>{health}</strong>
      </div>
      <div className="pet-bars">
        <span>
          <i style={{ width: "0%" }} />Diversification
        </span>
        <span>
          <i style={{ width: "0%" }} />Momentum
        </span>
        <span className="warning">
          <i style={{ width: "0%" }} />Concentration
        </span>
      </div>
      <div className="pet-message" data-preview-field="care">
        <HeartPulse size={16} /> {care} · {careCopy}. No wallet is assumed.
      </div>
      <ActionRow
        actions={[portfolioAction, "CALCULATE", "ALERT SETUP"]}
        onAction={onAction}
      />
    </div>
  );
}

function HuntPreview({
  values,
  onAction,
}: {
  values: Record<string, string>;
  onAction: (label: string) => void;
}) {
  const scope = values.scope || "New crypto products";
  const rank = values.rank || "Local saves";
  const context = values.context || "Market links";
  const submit = values.submit || "Private drafts";
  const submitAction =
    submit === "Team backend later"
      ? "PLAN TEAM BACKEND"
      : submit === "Invite-only later"
        ? "PLAN INVITES"
        : submit === "Public backend later"
          ? "PLAN PUBLIC BACKEND"
          : "ADD LOCAL DRAFT";

  return (
    <div className="hunt-card">
      <div className="hunt-title">
        <Rocket size={18} />
        <div>
          <strong data-preview-field="scope">{scope}</strong>
          <span data-preview-field="rank">Organized by {rank}</span>
        </div>
        <button type="button" onClick={() => onAction(submitAction)}>
          Add
        </button>
      </div>
      <div className="hunt-list">
        <button type="button" onClick={() => onAction("ADD LOCAL DRAFT")}>
          <span className="hunt-rank">+</span>
          <div>
            <b>No saved launches</b>
            <small data-preview-field="context">
              {context} · add a product, then verify its DropsTab context.
            </small>
            <em>LOCAL</em>
          </div>
        </button>
      </div>
      <div className="hunt-footer" data-preview-field="submit">
        <ListPlus size={14} /> {submit} · external submissions need a backend
      </div>
    </div>
  );
}

function RadioPreview({
  values,
  isPlaying,
  dataMode,
  onToggleAudio,
  onAction,
}: {
  values: Record<string, string>;
  isPlaying: boolean;
  dataMode: "sample" | "live";
  onToggleAudio: () => void;
  onAction: (label: string) => void;
}) {
  const show = values.show || "Market in 5";
  const source = values.source || "Top moves + catalysts";
  const voice = values.voice || "Calm analyst";
  const air = values.air || "Play now";
  const canPlayNow = air === "Play now";
  const airStatus =
    air === "Reminder setup"
      ? "Reminder stays local until notifications are connected"
      : air === "Export rundown"
        ? "Rundown export is prepared without claiming audio hosting"
        : air === "Telegram handoff"
          ? "Telegram delivery requires a verified channel connection"
          : "Browser speech is ready";
  const handleAirAction = () => {
    if (canPlayNow) onToggleAudio();
    else onAction(air.toUpperCase());
  };

  return (
    <div className="radio-card">
      <div className="radio-live">
        <i /> BROWSER AUDIO PREVIEW
      </div>
      <div className="radio-cover">
        <div className="cover-orbit one" />
        <div className="cover-orbit two" />
        <Radio size={54} />
        <strong data-preview-field="show">{show}</strong>
        <span data-preview-field="voice">{voice} · Browser Audio Brief</span>
      </div>
      <div className="radio-now">
        <div>
          <span>{isPlaying ? "BROWSER SPEECH" : voice.toUpperCase()}</span>
          <strong data-preview-field="source">{source}</strong>
          <small>
            {dataMode === "live"
              ? "Live DropsTab market context connected"
              : "Unlocks appear only after DropsTab connection"}
          </small>
        </div>
        <button
          type="button"
          onClick={handleAirAction}
          aria-label={canPlayNow ? (isPlaying ? "Pause audio" : "Play audio") : air}
        >
          {canPlayNow && isPlaying ? <Pause /> : canPlayNow ? <Play /> : <ArrowRight />}
        </button>
      </div>
      <div className={`waveform ${isPlaying ? "playing" : ""}`}>
        {Array.from({ length: 22 }).map((_, index) => (
          <i key={index} style={{ height: `${12 + ((index * 17) % 27)}px` }} />
        ))}
      </div>
      <div className="radio-footer" data-preview-field="air">
        <Volume2 size={15} />
        {air} · {airStatus} ·{" "}
        {dataMode === "live" ? "live DropsTab context" : "sample context"}
      </div>
    </div>
  );
}

function SiriPreview({
  values,
  isPlaying,
  onToggleAudio,
  onAction,
}: {
  values: Record<string, string>;
  isPlaying: boolean;
  onToggleAudio: () => void;
  onAction: (label: string) => void;
}) {
  const language = values.language || "English + Russian";
  const answer = values.answer || "Short + actionable";
  const commands = values.commands || "Ask + prepare alerts";
  const brain = values.brain || "Free Auto";
  const question =
    language === "Russian"
      ? "Что сегодня повлияло на мой портфель?"
      : language === "English"
        ? "What moved my portfolio today?"
        : language === "Auto detect"
          ? "Ask in any supported language"
          : "What moved my portfolio? · Что повлияло на портфель?";
  const answerCopy =
    answer === "Deep research"
      ? "I’ll assemble a sourced market, unlock and activity brief after you add holdings or choose an asset."
      : answer === "Voice only"
        ? "The answer will be spoken; the transcript remains available for accessibility."
        : answer === "Voice + cards"
          ? "The spoken answer will include sourced market cards and explicit next-step approvals."
          : "I’ll give a concise sourced answer and one safe next step after you provide context.";
  const commandActions =
    commands === "Research only"
      ? ["OPEN RESEARCH", "SHOW SOURCES"]
      : commands === "Portfolio after input"
        ? ["ADD HOLDINGS", "EXPLAIN MOVE"]
        : commands === "Full Action Engine plan"
          ? ["BUILD ACTION PLAN", "SET APPROVALS"]
          : ["PREPARE ALERT", "SHOW THE DATA"];

  return (
    <div className="siri-card">
      <div className="siri-orb">
        <span />
        <span />
        <span />
        <AudioLines size={48} />
      </div>
      <span className="siri-label" data-preview-field="language">
        {language}
      </span>
      <h3>“{question}”</h3>
      <div className="siri-answer">
        <Sparkles size={16} />
        <p>
          <strong data-preview-field="answer">{answer}.</strong> {answerCopy}
        </p>
      </div>
      <div className="siri-command-mode" data-preview-field="commands">
        {commands}
      </div>
      <div className="siri-suggestions">
        {commandActions.map((action) => (
          <button type="button" onClick={() => onAction(action)} key={action}>
            {action}
          </button>
        ))}
      </div>
      <button
        className={`mic-button ${isPlaying ? "listening" : ""}`}
        type="button"
        onClick={onToggleAudio}
      >
        <Mic2 size={20} />
        <span data-preview-field="brain">{brain}</span> ·{" "}
        {isPlaying ? "Listening…" : "Hold to ask"}
      </button>
    </div>
  );
}

export function PreviewCanvasVariants({
  preset,
  spec,
  values,
  market,
  dataMode,
  prediction,
  isPlaying,
  onToggleAudio,
  onAction,
}: PreviewVariantsProps) {
  switch (preset.preview) {
    case "engine":
      return <EnginePreview values={values} onAction={onAction} />;
    case "channel":
      return (
        <ChannelPreview
          spec={spec}
          values={values}
          market={market}
          dataMode={dataMode}
          onAction={onAction}
        />
      );
    case "prediction":
      return (
        <PredictionPreview
          values={values}
          market={market}
          prediction={prediction}
          onAction={onAction}
        />
      );
    case "copy":
      return <CopyPreview values={values} onAction={onAction} />;
    case "aggregator":
      return (
        <AggregatorPreview
          values={values}
          market={market}
          onAction={onAction}
        />
      );
    case "game":
      return (
        <GamePreview
          values={values}
          market={market}
          spec={spec}
          onAction={onAction}
        />
      );
    case "companion":
      return <CompanionPreview values={values} onAction={onAction} />;
    case "tamagotchi":
      return <TamagotchiPreview values={values} onAction={onAction} />;
    case "hunt":
      return <HuntPreview values={values} onAction={onAction} />;
    case "radio":
      return (
        <RadioPreview
          values={values}
          isPlaying={isPlaying}
          dataMode={dataMode}
          onToggleAudio={onToggleAudio}
          onAction={onAction}
        />
      );
    case "siri":
      return (
        <SiriPreview
          values={values}
          isPlaying={isPlaying}
          onToggleAudio={onToggleAudio}
          onAction={onAction}
        />
      );
    default:
      return null;
  }
}
