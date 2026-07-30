"use client";

import { useId, useMemo, useState } from "react";
import { BadgeCheck, Check, Search } from "lucide-react";

import type { ProviderModelCatalog } from "@/lib/provider-models";

interface ProviderModelPickerProps {
  catalog: ProviderModelCatalog | null;
  providerName: string;
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export function ProviderModelPicker({
  catalog,
  providerName,
  selectedModel,
  onSelectModel,
}: ProviderModelPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState("");

  const filteredModels = useMemo(() => {
    if (!catalog) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return catalog.models;
    return catalog.models.filter((model) =>
      model.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [catalog, query]);

  if (!catalog) {
    return (
      <div className="model-picker-awaiting" data-helper>
        <BadgeCheck aria-hidden="true" />
        <div>
          <strong>Model choice follows verification</strong>
          <span>
            Test the API key to load the model IDs returned by {providerName}.
          </span>
        </div>
      </div>
    );
  }

  if (!catalog.models.length) {
    return (
      <div className="model-picker-empty">
        <div className="model-picker-verified" data-helper>
          <BadgeCheck aria-hidden="true" />
          <div>
            <strong>Connection verified</strong>
            <span>
              {providerName} did not return a model catalog for this key. Enter
              the exact model ID supplied by the provider.
            </span>
          </div>
        </div>
        <label className="key-field">
          <span>Exact model ID</span>
          <input
            type="text"
            value={selectedModel}
            onChange={(event) => onSelectModel(event.target.value)}
            placeholder="Model ID from the provider"
          />
        </label>
      </div>
    );
  }

  return (
    <section className="model-picker" aria-label={`${providerName} models`}>
      <div className="model-picker-heading">
        <span className="model-picker-status">
          <BadgeCheck aria-hidden="true" />
          Verified this session
        </span>
        <span data-metadata>
          {catalog.totalModelCount} model
          {catalog.totalModelCount === 1 ? "" : "s"} returned
        </span>
      </div>
      <label className="model-search" htmlFor={`${listId}-search`}>
        <Search aria-hidden="true" />
        <input
          id={`${listId}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search provider-returned models"
          aria-label="Search provider-returned models"
          aria-controls={listId}
        />
      </label>
      <div
        id={listId}
        className="model-options"
        role="group"
        aria-label="Provider-returned model IDs"
      >
        {filteredModels.map((model) => (
          <button
            type="button"
            aria-pressed={selectedModel === model}
            className={selectedModel === model ? "selected" : ""}
            key={model}
            onClick={() => onSelectModel(model)}
          >
            <span>{model}</span>
            {selectedModel === model ? <Check aria-hidden="true" /> : null}
          </button>
        ))}
        {!filteredModels.length ? (
          <div className="model-options-empty" data-helper>
            No provider-returned model matches “{query.trim()}”.
          </div>
        ) : null}
      </div>
      <p className="model-picker-note" data-helper>
        Selected: <strong>{selectedModel || "Choose a model"}</strong>. The ID
        stays in this browser tab; build compatibility is checked on first use.
        {catalog.modelsTruncated
          ? " This list contains the bounded provider response returned during verification."
          : ""}
      </p>
    </section>
  );
}
