import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import "@/app/styles/drops-studio.dialogs.css";
import { ProviderModelPicker } from "@/components/provider-model-picker";
import type { ProviderModelCatalog } from "@/lib/provider-models";

const verifiedCatalog: ProviderModelCatalog = {
  models: [
    "anthropic/claude-sonnet",
    "google/gemini-flash",
    "openai/gpt-5-mini",
    "openrouter/free",
  ],
  totalModelCount: 4,
  modelsTruncated: false,
  verifiedAt: "2026-07-30T00:00:00.000Z",
};

function InteractivePicker({
  catalog,
}: {
  catalog: ProviderModelCatalog | null;
}) {
  const [selectedModel, setSelectedModel] = useState(
    catalog?.models[0] ?? "",
  );
  return (
    <div style={{ maxWidth: 560, padding: 24 }}>
      <ProviderModelPicker
        catalog={catalog}
        providerName="OpenRouter"
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />
    </div>
  );
}

const meta = {
  title: "Connections/ProviderModelPicker",
  component: ProviderModelPicker,
  tags: ["autodocs"],
  args: {
    catalog: null,
    providerName: "OpenRouter",
    selectedModel: "",
    onSelectModel: fn(),
  },
} satisfies Meta<typeof ProviderModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingVerification: Story = {
  render: () => <InteractivePicker catalog={null} />,
};

export const VerifiedModels: Story = {
  render: () => <InteractivePicker catalog={verifiedCatalog} />,
};

export const EmptyProviderCatalog: Story = {
  render: () => (
    <InteractivePicker
      catalog={{
        models: [],
        totalModelCount: 0,
        modelsTruncated: false,
        verifiedAt: "2026-07-30T00:00:00.000Z",
      }}
    />
  ),
};
