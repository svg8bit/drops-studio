import { designBriefSchema, type DesignBrief, type DesignDirection, type DesignDirectionSelection } from "./types.ts";

function normalizedCategory(category: string): string {
  return category.trim().replace(/\s+/g, " ");
}

export function proposeDesignDirections(value: DesignBrief): DesignDirection[] {
  const brief = designBriefSchema.parse(value);
  const category = normalizedCategory(brief.category);
  const references = brief.referenceIds.length ? brief.referenceIds.join(", ") : "the project design contract";
  return [
    {
      id: "signal-command-center",
      label: "Signal Command Center",
      thesis: `A high-trust ${category} workspace organized around decisions, provenance, and live operational state.`,
      hierarchy: ["decision header", "primary signal canvas", "evidence rail", "approval-aware actions"],
      interactionModel: "Filter and inspect a signal, then review its evidence before any external action.",
      responsiveStrategy: "Desktop uses an asymmetric evidence rail; tablet stacks evidence below the canvas; mobile preserves the signal-to-action sequence.",
      brandExpression: `DropsTab intelligence density with Drops Studio builder precision, grounded in ${references}.`,
      categorySignals: [category, "provider evidence", "freshness", "risk"],
      deterministicScore: 94,
    },
    {
      id: "research-narrative",
      label: "Research Narrative",
      thesis: `An editorial ${category} product that turns raw events into a sourced, readable market thesis.`,
      hierarchy: ["market thesis", "event narrative", "source cards", "related intelligence"],
      interactionModel: "Move from a concise thesis into chronological evidence and source-level detail.",
      responsiveStrategy: "Editorial measure remains readable at every width; dense tables become labeled cards without hiding fields.",
      brandExpression: `A calmer DropsTab research surface using local typography, spacing, and tokens from ${references}.`,
      categorySignals: [category, "source attribution", "timeline", "research links"],
      deterministicScore: 88,
    },
    {
      id: "alert-operations",
      label: "Alert Operations",
      thesis: `An event-first ${category} control surface for triage, rules, and explicit delivery approval.`,
      hierarchy: ["event inbox", "relevance score", "rule explanation", "delivery readiness"],
      interactionModel: "Triage an event, inspect enrichment and rules, then approve or reject its proposed delivery.",
      responsiveStrategy: "Desktop supports queue-and-detail; tablet and mobile use a deterministic inbox-to-detail drilldown.",
      brandExpression: `Drops Bot operational clarity paired with DropsTab context and project-local components from ${references}.`,
      categorySignals: [category, "event status", "rule evidence", "setup required"],
      deterministicScore: /alert|wallet|whale|channel|monitor/i.test(`${brief.category} ${brief.prompt}`) ? 97 : 86,
    },
  ];
}

export function selectDesignDirection(value: DesignBrief): DesignDirectionSelection {
  const brief = designBriefSchema.parse(value);
  const directions = proposeDesignDirections(brief);
  if (brief.selectedDirectionId) {
    const selected = directions.find((direction) => direction.id === brief.selectedDirectionId);
    if (!selected) throw new Error(`Unknown design direction ${brief.selectedDirectionId}.`);
    return {
      status: "selected",
      directions,
      selectedDirection: selected,
      selectionPolicy: "explicit-user",
      reason: "The live user explicitly selected this structured direction.",
    };
  }
  if (!brief.unattended) {
    return {
      status: "awaiting-user-selection",
      directions,
      selectedDirection: null,
      selectionPolicy: "user-review",
      reason: "Live design work preserves user review of all three directions before mutation.",
    };
  }
  const selected = [...directions].sort((left, right) => right.deterministicScore - left.deterministicScore || left.id.localeCompare(right.id))[0];
  return {
    status: "selected",
    directions,
    selectedDirection: selected,
    selectionPolicy: "deterministic-eval",
    reason: `Unattended evaluation selected the highest deterministic rubric score (${selected.deterministicScore}).`,
  };
}
