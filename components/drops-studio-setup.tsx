"use client";

import "@/app/styles/tailwind.css";
import "@/app/styles/drops-studio.setup.css";
import {
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Check,
  Cloud,
  Code2,
  LoaderCircle,
  Plus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Preset } from "@/lib/presets";
import type { GeneratedProjectSpec } from "@/lib/project-types";

export interface SetupTool {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface SetupProvider {
  id: string;
  name: string;
}

interface DropsStudioSetupProps {
  preset: Preset;
  draftSpec: GeneratedProjectSpec | null;
  customMode: boolean;
  values: Record<string, string>;
  tools: SetupTool[];
  selectedTools: string[];
  providers: SetupProvider[];
  connections: Record<string, boolean>;
  activeBrain: string;
  dataMode: "sample" | "live";
  building: boolean;
  onCustomModeChange: (checked: boolean) => void;
  onUpdateField: (fieldId: string, value: string) => void;
  onSelectAllTools: () => void;
  onToggleTool: (toolId: string) => void;
  onAddTool: () => void;
  onChooseProvider: (providerId: string) => void;
  onRefreshMarket: () => void;
  onBuild: () => void;
  onBlank: () => void;
}

function SelectControl({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") onChange(nextValue);
      }}
    >
      <SelectTrigger className="field-select" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="select-content" align="start" sideOffset={6}>
        {options.map((option) => (
          <SelectItem className="select-item" key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DropsStudioSetup({
  preset,
  draftSpec,
  customMode,
  values,
  tools,
  selectedTools,
  providers,
  connections,
  activeBrain,
  dataMode,
  building,
  onCustomModeChange,
  onUpdateField,
  onSelectAllTools,
  onToggleTool,
  onAddTool,
  onChooseProvider,
  onRefreshMarket,
  onBuild,
  onBlank,
}: DropsStudioSetupProps) {
  return (
    <section className="setup-card">
      <div className="setup-heading">
        <div>
          <span>
            {draftSpec
              ? "AI PRODUCT BLUEPRINT"
              : customMode
                ? "YOUR CUSTOM BLUEPRINT"
                : "SET UP THIS RECIPE"}
          </span>
          <h2>{draftSpec?.name ?? preset.title}</h2>
          <p>{draftSpec?.description ?? preset.description}</p>
        </div>
        <label className="custom-switch">
          <span>Custom mode</span>
          <Switch
            checked={customMode}
            onCheckedChange={onCustomModeChange}
            aria-label="Custom mode"
          />
        </label>
      </div>

      <div className="field-grid">
        {preset.fields.map((field) => (
          <label className="config-field" key={field.id}>
            <span>{field.label}</span>
            <SelectControl
              value={values[field.id] ?? field.value}
              options={field.options}
              onChange={(value) => onUpdateField(field.id, value)}
              ariaLabel={field.label}
            />
          </label>
        ))}
      </div>

      {draftSpec ? (
        <details className="blueprint-review" open>
          <summary>
            <span>
              <strong>Review the build plan</strong>
              <small>
                {draftSpec.blueprint.screens.length} screens ·{" "}
                {draftSpec.blueprint.interactions.length} interactions ·{" "}
                {draftSpec.brain.provider === "free"
                  ? "no model charge"
                  : `${draftSpec.brain.model} · your provider budget`}
              </small>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </summary>
          <div className="blueprint-review-grid">
            <section>
              <span>SCREENS</span>
              <ul>
                {draftSpec.blueprint.screens.slice(0, 6).map((screen) => (
                  <li key={screen}>{screen}</li>
                ))}
              </ul>
            </section>
            <section>
              <span>ACTIONS</span>
              <ul>
                {draftSpec.blueprint.interactions
                  .slice(0, 6)
                  .map((interaction) => (
                    <li key={interaction}>{interaction}</li>
                  ))}
              </ul>
            </section>
            <section>
              <span>ACCEPTANCE CHECKS</span>
              <ul>
                {draftSpec.blueprint.acceptanceChecks
                  .slice(0, 6)
                  .map((check) => (
                    <li key={check}>{check}</li>
                  ))}
              </ul>
            </section>
          </div>
          <div className="blueprint-boundary">
            <BadgeCheck size={17} aria-hidden="true" />
            <span>
              <strong>Foundation:</strong>{" "}
              {draftSpec.blueprint.dropsTabUse.slice(0, 2).join(" · ")} ·{" "}
              {draftSpec.blueprint.dropsBotUse.slice(0, 2).join(" · ")}
            </span>
          </div>
        </details>
      ) : null}

      {customMode ? (
        <div className="custom-stack">
          <div className="custom-stack-heading">
            <div>
              <BrainCircuit size={18} />
              <span>
                <strong>Recommended stack</strong>
                <small>Toggle any capability. The blueprint stays editable.</small>
              </span>
            </div>
            <button type="button" onClick={onSelectAllTools}>
              Select all
            </button>
          </div>
          <div className="tool-grid">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const active = selectedTools.includes(tool.id);
              return (
                <button
                  type="button"
                  className={active ? "active" : ""}
                  key={tool.id}
                  onClick={() => onToggleTool(tool.id)}
                >
                  <Icon size={16} />
                  {tool.label}
                  {active ? <Check size={14} /> : null}
                </button>
              );
            })}
          </div>
          <button className="add-custom-tool" type="button" onClick={onAddTool}>
            <Plus size={15} /> Add API, skill or custom endpoint
          </button>
        </div>
      ) : null}

      <div className="brain-row">
        <div className="brain-label">
          <BrainCircuit size={18} />
          <div>
            <strong>Choose the brain</strong>
            <span>Free Auto works now. Bring your own model when you want more.</span>
          </div>
        </div>
        <div className="provider-chips">
          {providers.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => onChooseProvider(item.id)}
              className={`${connections[item.id] ? "connected" : ""} ${activeBrain === item.id ? "active-brain" : ""}`}
            >
              <span>
                {item.id === "free" ? (
                  <Sparkles />
                ) : item.id === "custom" ? (
                  <Code2 />
                ) : (
                  <Cloud />
                )}
              </span>
              {item.name}
              {activeBrain === item.id ? (
                <BadgeCheck size={13} />
              ) : connections[item.id] ? (
                <Check size={13} />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="source-strip">
        <div>
          <BadgeCheck size={16} />
          <span>
            <strong>Verified foundation</strong> ·{" "}
            {(draftSpec?.tools ?? preset.tools).join(" · ")}
          </span>
        </div>
        <button type="button" onClick={onRefreshMarket}>
          {dataMode === "live" ? "Refresh live data" : "Connect live data"}
        </button>
      </div>

      <button
        className="build-button"
        type="button"
        onClick={onBuild}
        disabled={building}
      >
        {building ? (
          <>
            <LoaderCircle className="spin" size={19} />
            Compiling and running release checks…
          </>
        ) : (
          <>
            <Sparkles size={19} />
            {draftSpec ? `Build ${draftSpec.name}` : preset.cta}
            <ArrowRight size={18} />
          </>
        )}
      </button>
      <button className="blank-button" type="button" onClick={onBlank}>
        Start from a blank canvas
      </button>
    </section>
  );
}
