"use client";

import "@/app/styles/drops-studio.previews.css";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Clock3,
  Code2,
  Database,
  Eye,
  ExternalLink,
  FileCode2,
  Folder,
  Flame,
  Link2,
  ListChecks,
  Monitor,
  MoreVertical,
  Rocket,
  Share2,
  ShieldCheck,
  Sparkles,
  TestTube2,
  ThumbsUp,
  TrendingUp,
  Workflow,
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

const formatSigned = (value: number | null) =>
  value === null
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const PreviewCanvasVariants = dynamic(
  () =>
    import("@/components/preview-canvas-variants").then(
      (module) => module.PreviewCanvasVariants,
    ),
  { ssr: false },
);

function BriefPreview({
  market,
  spec,
  values,
  dataMode,
  onAction,
}: {
  market: MarketCoin[];
  spec?: GeneratedProjectSpec;
  values: Record<string, string>;
  dataMode: "sample" | "live";
  onAction: (label: string) => void;
}) {
  const leader = market[0] ?? {
    symbol: "BTC",
    name: "Bitcoin",
    price: "—",
    change: null,
    marketCap: "—",
  };
  const sectionMode = values.sections || "Moves + unlocks + funding";
  const isSample = dataMode === "sample";
  const briefingBlocks =
    sectionMode === "Only actionable"
      ? [
          {
            id: "move",
            icon: <TrendingUp size={17} />,
            title: "Actionable move",
            value: `${leader.symbol} ${formatSigned(leader.change)}`,
            copy:
              leader.change === null
                ? "Waiting for a sourced price move before suggesting a review."
                : isSample
                  ? `${leader.name} leads this labelled sample watchlist. Connect DropsTab before acting.`
                  : `${leader.name} is the strongest available move. Review the source before acting.`,
          },
          {
            id: "risk",
            icon: <ShieldCheck size={17} />,
            title: "Risk check",
            value: isSample ? "ARB · $32.4M" : "Needs connection",
            copy: isSample
              ? "Sample unlock risk is surfaced next to the move so the brief stays decision-ready."
              : "Unlock and liquidity checks stay unavailable until the relevant DropsTab data is connected.",
          },
        ]
      : sectionMode === "Full market map"
        ? [
            {
              id: "breadth",
              icon: <TrendingUp size={17} />,
              title: "Watchlist leader",
              value: `${leader.symbol} ${formatSigned(leader.change)}`,
              copy: `${leader.name} leads the currently available market rows.`,
            },
            {
              id: "unlocks",
              icon: <Clock3 size={17} />,
              title: "Unlock map",
              value: isSample ? "$32.4M" : "Needs connection",
              copy: isSample
                ? "ARB unlocks in 2 days in this sample schedule."
                : "No unlock value is invented while the unlock dataset is unavailable.",
            },
            {
              id: "funding",
              icon: <Rocket size={17} />,
              title: "Funding map",
              value: isSample ? "$18.7M" : "Needs connection",
              copy: isSample
                ? "Three projects raised in the sample 24-hour window."
                : "Connect funding rounds to add sourced investor activity.",
            },
          ]
        : sectionMode === "My custom sections"
          ? [
              {
                id: "custom",
                icon: <Rocket size={17} />,
                title: "Custom briefing slot",
                value: "Ready to configure",
                copy: "Describe the sections you want; the Director will keep unsupported data clearly unavailable.",
              },
            ]
          : [
              {
                id: "move",
                icon: <TrendingUp size={17} />,
                title: "Biggest move",
                value: `${leader.symbol} ${formatSigned(leader.change)}`,
                copy:
                  leader.change === null
                    ? "Live percentage change is not available yet."
                    : `${leader.name} leads your watchlist as market activity accelerates.`,
              },
              {
              id: "unlocks",
              icon: <Clock3 size={17} />,
              title: "Next unlock",
              value: isSample ? "$32.4M" : "Not connected",
              copy: isSample
                ? "ARB unlocks in 2 days · sample schedule."
                : "Connect the DropsTab unlock endpoint before this section can show a sourced event.",
            },
            {
              id: "funding",
              icon: <Rocket size={17} />,
              title: "Fresh funding",
              value: isSample ? "$18.7M" : "Not connected",
              copy: isSample
                ? "Three projects raised in the sample 24-hour window."
                : "No funding value is shown until a DropsTab funding response is available.",
            },
          ];

  return (
    <div className="telegram-card">
      <div className="message-title">
        <span className="message-icon sun"><TrendingUp size={17} /></span>
        <div>
          <strong>{spec?.blueprint.content.headline ?? "Morning Alpha"}</strong>
          <span>
            Today · <b data-preview-field="time">{values.time || "08:00 UTC"}</b>
            {" · "}
            <b data-preview-field="assets">{values.assets || "BTC, ETH, SOL"}</b>
          </span>
        </div>
      </div>
      {briefingBlocks.map((block, index) => (
        <div
          className={`brief-block ${index === briefingBlocks.length - 1 ? "last" : ""}`}
          key={block.id}
        >
          <div className="brief-heading">
            {block.icon}
            <strong>{block.title}</strong>
            <b>{block.value}</b>
          </div>
          <p>{block.copy}</p>
          {block.id === "move" ||
          block.id === "breadth" ||
          (isSample && ["risk", "unlocks", "funding"].includes(block.id)) ? (
            <button type="button" onClick={() => onAction("OPEN IN DROPSTAB")}>
              {isSample ? "Explore on DropsTab" : "Open in DropsTab"} <ExternalLink size={13} />
            </button>
          ) : block.id === "custom" ? (
            <button type="button" onClick={() => onAction("EDIT BRIEF SECTIONS")}>
              Edit sections <ArrowRight size={13} />
            </button>
          ) : (
            <button type="button" onClick={() => onAction("CONNECT DROPSTAB")}>
              Open data setup <ArrowRight size={13} />
            </button>
          )}
        </div>
      ))}
      <div className="source-row" data-preview-field="sections">
        <Image
          src="/brand/dropstab-mark.svg"
          alt="DropsTab"
          width={32}
          height={32}
          unoptimized
        />
        {sectionMode} ·{" "}
        <b data-preview-field="brain">{values.brain || "Free Auto"}</b>
      </div>
    </div>
  );
}

export function PreviewCanvas({ preset, spec, values, market, dataMode, prediction, isPlaying, onToggleAudio, onAction }: PreviewCanvasProps) {
  const content = preset.preview === "brief" ? (
    <BriefPreview
      market={market}
      spec={spec}
      values={values}
      dataMode={dataMode}
      onAction={onAction}
    />
  ) : (
    <PreviewCanvasVariants
      preset={preset}
      spec={spec}
      values={values}
      market={market}
      dataMode={dataMode}
      prediction={prediction}
      isPlaying={isPlaying}
      onToggleAudio={onToggleAudio}
      onAction={onAction}
    />
  );

  const isTelegram = preset.preview === "channel" || preset.preview === "brief";
  const isGame = preset.preview === "game";
  const surface = isTelegram ? "telegram-native" : isGame ? "game-native" : `${preset.preview}-native`;
  const visibleName = isTelegram
    ? preset.preview === "brief"
      ? "Morning Alpha"
      : values.niche || "Alpha Channel"
    : spec?.name ?? preset.output;
  const telegramStatus =
    preset.preview === "brief"
      ? "Brief preview · delivery not connected"
      : "Channel preview · not connected";
  const channelGrowthAction =
    values.earn === "Caller-link plan"
      ? "Configure caller links"
      : values.earn === "Paid-channel plan"
        ? "Plan paid access"
        : values.earn === "Sponsor-slot plan"
          ? "Plan sponsor slot"
          : "Plan growth loop";

  return (
    <section className="preview-column" aria-live="polite">
      <div className="preview-status-row">
        <span className="preview-ready"><Eye size={17} /> {spec ? "Product plan" : preset.shortTitle} · Concept preview</span>
        <span className={`data-mode ${dataMode}`}><i /> {dataMode === "live" ? "Live DropsTab data" : "Sample data"}</span>
      </div>
      <div className="landing-studio-frame">
        <div className="landing-studio-toolbar">
          <div>
            <Image
              src="/brand/dropstab-mark.svg"
              alt=""
              width={22}
              height={22}
              unoptimized
            />
            <strong>Drops Studio</strong>
            <span>/</span>
            <b>{visibleName}</b>
          </div>
          <div className="landing-studio-actions">
            <button type="button" onClick={() => onAction("SHARE")}>
              <Share2 aria-hidden="true" /> Share
            </button>
            <button className="primary" type="button" onClick={() => onAction("BUILD PROJECT")}>
              <Rocket aria-hidden="true" /> Build project
            </button>
          </div>
        </div>
        <div className="landing-studio-body">
          <nav className="landing-studio-rail" aria-label="Concept workspace sections">
            <span className="active"><Monitor aria-hidden="true" /> Studio</span>
            <span><Database aria-hidden="true" /> Data</span>
            <span><Link2 aria-hidden="true" /> Connect</span>
            <span><Workflow aria-hidden="true" /> Logic</span>
            <span><TestTube2 aria-hidden="true" /> Test</span>
          </nav>
          <div className="landing-studio-main">
            <div className="landing-studio-address">
              <span><i /> Preview</span>
              <b>{spec ? `${spec.slug}.preview` : "Build to create a live Sandbox URL"}</b>
              <Monitor aria-hidden="true" />
            </div>
            <div className={`preview-device ${surface}`} style={{ "--preview-accent": preset.accent, "--preview-tint": preset.tint } as React.CSSProperties}>
              <div className="preview-device-header">
                {isTelegram && <span className="telegram-back" aria-hidden="true"><ArrowLeft /></span>}
                <div className={`preview-brand-mark ${isTelegram ? "drops-bot" : "dropstab"}`}>
                  <Image
                    src={isTelegram ? "/brand/drops-bot-avatar.png" : "/brand/dropstab-mark.svg"}
                    alt={isTelegram ? "Drops Bot" : "DropsTab"}
                    width={32}
                    height={32}
                    unoptimized
                  />
                </div>
                <div className="preview-profile">
                  <strong>{visibleName}</strong>
                  <span>{isTelegram ? telegramStatus : isGame ? "Playable local build · market-data adapter" : spec?.tagline ?? "Built with Drops Studio"}</span>
                </div>
                <MoreVertical className="preview-options" aria-hidden="true" />
              </div>
              {!isTelegram && !isGame && spec && (
                <div
                  aria-label="Product preview screens"
                  className="native-screen-tabs"
                  role="region"
                  tabIndex={0}
                >
                  {spec.blueprint.screens.slice(0, 4).map((screen, index) => (
                    <span className={index === 0 ? "active" : ""} key={`${screen}-${index}`}>
                      {screen}
                    </span>
                  ))}
                </div>
              )}
              <div className="preview-stage">{content}</div>
              {isTelegram && (
                <div className="preview-reactions" aria-label="Telegram post preview footer">
                  <span><Flame size={16} /> —</span>
                  <span><ThumbsUp size={16} /> —</span>
                  <span><Eye size={16} /> Preview</span>
                  <button
                    aria-label="Preview Telegram share action"
                    className="telegram-share-preview"
                    onClick={() => onAction("SHARE PREVIEW")}
                    type="button"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>
          <aside className="landing-studio-copilot" aria-label="Current build plan">
            <div className="landing-copilot-title">
              <Sparkles aria-hidden="true" />
              <strong>AI Director</strong>
              <span>{spec ? "Plan ready" : "Template mode"}</span>
            </div>
            <p>
              {spec
                ? `Your ${spec.blueprint.productType} plan is editable before the isolated build starts.`
                : `Start with ${preset.shortTitle}, or describe a different crypto product.`}
            </p>
            <div className="landing-copilot-card">
              <ListChecks aria-hidden="true" />
              <div>
                <strong>{spec ? `${spec.blueprint.screens.length} planned screens` : "Plan before build"}</strong>
                <span>{spec ? `${spec.blueprint.interactions.length} interactions` : "Review screens, logic and connections."}</span>
              </div>
            </div>
            <div className="landing-copilot-card">
              <Folder aria-hidden="true" />
              <div>
                <strong>Editable source</strong>
                <span>Next.js, React, TypeScript and tests.</span>
              </div>
            </div>
            <div className="landing-copilot-card">
              <Blocks aria-hidden="true" />
              <div>
                <strong>Drops-native</strong>
                <span>DropsTab intelligence and approved delivery.</span>
              </div>
            </div>
            <button type="button" onClick={() => onAction("EDIT PLAN")}>
              <Code2 aria-hidden="true" />
              {spec ? "Review this plan" : "Create an editable plan"}
              <FileCode2 aria-hidden="true" />
            </button>
          </aside>
        </div>
        <div className="landing-studio-statusbar">
          <span><ShieldCheck aria-hidden="true" /> No external action without approval</span>
          <span>{dataMode === "live" ? "DropsTab receipt verified" : "Sample data is labelled"}</span>
          <span>Sandbox starts after Build</span>
        </div>
      </div>
      {preset.preview === "channel" ? (
        <aside
          className="studio-preview-workflow"
          aria-label="Studio actions outside Telegram preview"
        >
          <div className="studio-preview-workflow-copy">
            <span>STUDIO WORKFLOW</span>
            <strong>Build this channel</strong>
            <small>These controls are outside the Telegram preview.</small>
          </div>
          <div className="studio-preview-workflow-actions">
            <button type="button" onClick={() => onAction("CONNECT CHANNEL")}>
              Connect Telegram
            </button>
            <button type="button" onClick={() => onAction("GENERATE DRAFT")}>
              Generate draft
            </button>
            <button type="button" onClick={() => onAction(channelGrowthAction.toUpperCase())}>
              {channelGrowthAction}
            </button>
          </div>
        </aside>
      ) : null}
      <p className="preview-footnote"><ShieldCheck size={14} /> Concept preview only. Real data, delivery and public state are labelled separately.</p>
    </section>
  );
}
