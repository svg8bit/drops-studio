import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { useState } from "react"
import { expect, fn, userEvent, waitFor } from "storybook/test"

import {
  PreviewCanvas,
  type MarketCoin,
  type PredictionEvent,
} from "@/components/preview-canvas"
import { presets, type PresetId } from "@/lib/presets"
import { createProjectSpec } from "@/lib/project-factory"

const connectedMarket: MarketCoin[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: "$118,420",
    change: 2.4,
    marketCap: "$2.36T",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: "$3,780",
    change: 1.6,
    marketCap: "$456B",
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: "$192.40",
    change: -0.8,
    marketCap: "$102B",
  },
]

const unavailableMarket: MarketCoin[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: "Unavailable",
    change: null,
    marketCap: "Unavailable",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: "Unavailable",
    change: null,
    marketCap: "Unavailable",
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: "Unavailable",
    change: null,
    marketCap: "Unavailable",
  },
]

const connectedPrediction: PredictionEvent = {
  title: "SOL ETF approval this year",
  probability: 64,
  change: 7,
  url: "https://polymarket.com/",
}

const unavailablePrediction: PredictionEvent = {
  title: "SOL ETF approval this year",
  probability: null,
  change: null,
}

function presetById(id: PresetId) {
  const preset = presets.find((item) => item.id === id)
  if (!preset) throw new Error(`Missing preview preset: ${id}`)
  return preset
}

function valuesFor(id: PresetId) {
  return Object.fromEntries(
    presetById(id).fields.map((field) => [field.id, field.value])
  )
}

function projectFor(
  id: PresetId,
  prompt: string,
  market: MarketCoin[] = connectedMarket,
  prediction: PredictionEvent = connectedPrediction
) {
  const preset = presetById(id)

  return createProjectSpec({
    presetId: id,
    values: valuesFor(id),
    prompt,
    tools: preset.tools,
    provider: "free",
    model: "Free Auto",
    market,
    prediction,
    origin: "https://drops-studio.example",
  })
}

function valuesForOptionSet(id: PresetId, optionIndex: number) {
  return Object.fromEntries(
    presetById(id).fields.map((field) => [
      field.id,
      field.options[optionIndex] ?? field.value,
    ])
  )
}

function NativeFieldOptionContract() {
  const [presetIndex, setPresetIndex] = useState(0)
  const [optionIndex, setOptionIndex] = useState(0)
  const preset = presets[presetIndex]
  const values = valuesForOptionSet(preset.id, optionIndex)
  const spec = createProjectSpec({
    presetId: preset.id,
    values,
    prompt: `${preset.shortTitle} native preview field contract`,
    tools: preset.tools,
    provider: "free",
    model: "Free Auto",
    market: connectedMarket,
    prediction: connectedPrediction,
    origin: "https://drops-studio.example",
  })

  function showNextOptionSet() {
    if (optionIndex < 3) {
      setOptionIndex((current) => current + 1)
      return
    }
    setOptionIndex(0)
    setPresetIndex((current) => Math.min(presets.length - 1, current + 1))
  }

  return (
    <div
      data-testid="native-field-option-contract"
      data-preset-index={presetIndex}
      data-option-index={optionIndex}
    >
      <button
        aria-label="Show next native preview option set"
        onClick={showNextOptionSet}
        style={{ minHeight: 44, minWidth: 220 }}
        type="button"
      >
        Next native option set
      </button>
      <PreviewCanvas
        dataMode="sample"
        isPlaying={false}
        market={connectedMarket}
        onAction={fn()}
        onToggleAudio={fn()}
        prediction={connectedPrediction}
        preset={preset}
        spec={spec}
        values={values}
      />
    </div>
  )
}

function PreviewViewport({
  children,
  width,
  label,
}: {
  children: React.ReactNode
  width: number
  label: string
}) {
  return (
    <div
      aria-label={label}
      style={{ margin: "0 auto", maxWidth: "100%", width }}
    >
      {children}
    </div>
  )
}

const desktop = (StoryComponent: React.ComponentType) => (
  <PreviewViewport label="Desktop product preview" width={760}>
    <StoryComponent />
  </PreviewViewport>
)

const mobile = (StoryComponent: React.ComponentType) => (
  <PreviewViewport label="Mobile product preview" width={390}>
    <StoryComponent />
  </PreviewViewport>
)

const meta = {
  title: "Product states/Native previews",
  component: PreviewCanvas,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The production PreviewCanvas and its category-native variants. Stories cover all 12 presets, provider/data boundaries, empty and populated content, and the required desktop/mobile widths without replacing the real preview implementation.",
      },
    },
  },
  decorators: [
    (StoryComponent) => (
      <div style={{ margin: "0 auto", maxWidth: 808, padding: 24 }}>
        <StoryComponent />
      </div>
    ),
  ],
  args: {
    market: connectedMarket,
    prediction: connectedPrediction,
    dataMode: "sample",
    isPlaying: false,
    onAction: fn(),
    onToggleAudio: fn(),
  },
} satisfies Meta<typeof PreviewCanvas>

export default meta
type Story = StoryObj<typeof meta>

// State coverage: no spec yet is the real pre-plan/loading contract used while
// the Director is still assembling a product plan.
export const LoadingProductPlan: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("action-engine"),
    values: valuesFor("action-engine"),
    market: unavailableMarket,
    prediction: unavailablePrediction,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Loading/planning contract: PreviewCanvas has not received a generated project spec and clearly remains a concept preview.",
      },
    },
  },
}

// 1. Intelligence-to-Action Engine
export const ActionEngineDesktop: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("action-engine"),
    spec: projectFor(
      "action-engine",
      "Build a sourced SOL catalyst decision engine"
    ),
    values: valuesFor("action-engine"),
  },
}

// 2. Alpha Channel. This is intentionally disconnected: PreviewCanvas must
// never claim that a Telegram channel exists without verified provider state.
export const AlphaChannelDisconnected: Story = {
  decorators: [mobile],
  args: {
    preset: presetById("alpha-channel"),
    spec: projectFor(
      "alpha-channel",
      "Create a sourced Solana smart-money Telegram channel"
    ),
    values: valuesFor("alpha-channel"),
    dataMode: "sample",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Disconnected external-provider state. The real channel preview stays labelled PREVIEW · NOT PUBLISHED and exposes the connection action.",
      },
    },
  },
}

// 3. AI Morning Alpha
export const MorningAlphaPopulated: Story = {
  decorators: [mobile],
  args: {
    preset: presetById("morning-alpha"),
    spec: projectFor("morning-alpha", "Build my daily crypto briefing"),
    values: valuesFor("morning-alpha"),
    dataMode: "live",
  },
}

// Error/degraded-data coverage uses the component's real nullable market and
// prediction contracts instead of substituting an invented error card.
export const MorningAlphaDataError: Story = {
  decorators: [mobile],
  args: {
    preset: presetById("morning-alpha"),
    spec: projectFor(
      "morning-alpha",
      "Build my daily crypto briefing",
      unavailableMarket,
      unavailablePrediction
    ),
    values: valuesFor("morning-alpha"),
    market: unavailableMarket,
    prediction: unavailablePrediction,
    dataMode: "sample",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Error/degraded-data contract. Missing values remain unavailable and unconnected sections are explicit; no crypto number is fabricated.",
      },
    },
  },
}

// 4. Prediction-to-Crypto Impact Trader
export const PredictionImpactDesktop: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("prediction-impact"),
    spec: projectFor(
      "prediction-impact",
      "Map SOL ETF prediction odds to a research basket"
    ),
    values: valuesFor("prediction-impact"),
    dataMode: "live",
  },
}

// 5. Smart Money Copy Strategy
export const SmartMoneyCopyEmpty: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("smart-money-copy"),
    spec: projectFor(
      "smart-money-copy",
      "Build a capped paper strategy from public wallet alerts"
    ),
    values: valuesFor("smart-money-copy"),
    dataMode: "sample",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Empty strategy state before a public wallet and alert source are connected.",
      },
    },
  },
}

// 6. Crypto Aggregator. dataMode=live is the real connected DropsTab state
// exposed by PreviewCanvas.
export const CryptoAggregatorConnected: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("crypto-aggregator"),
    spec: projectFor(
      "crypto-aggregator",
      "Build a searchable live crypto market explorer"
    ),
    values: valuesFor("crypto-aggregator"),
    dataMode: "live",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Connected/populated DropsTab state with market rows and explicit attribution.",
      },
    },
  },
}

// 7. Crypto Game
export const CryptoGameDesktop: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("crypto-game"),
    spec: projectFor(
      "crypto-game",
      "Create an original 1970s Eastern-European cartoon wolf market catcher"
    ),
    values: valuesFor("crypto-game"),
  },
}

// 8. Personal Crypto Companion
export const PersonalCompanionMobile: Story = {
  decorators: [mobile],
  args: {
    preset: presetById("personal-companion"),
    spec: projectFor(
      "personal-companion",
      "Build a personal crypto discovery companion"
    ),
    values: valuesFor("personal-companion"),
  },
}

// 9. Portfolio Tamagotchi
export const PortfolioTamagotchiEmpty: Story = {
  decorators: [mobile],
  args: {
    preset: presetById("portfolio-tamagotchi"),
    spec: projectFor(
      "portfolio-tamagotchi",
      "Build a portfolio Tamagotchi that starts with no assumed holdings"
    ),
    values: valuesFor("portfolio-tamagotchi"),
  },
}

// 10. Crypto Product Hunt
export const CryptoProductHuntEmpty: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("crypto-product-hunt"),
    spec: projectFor(
      "crypto-product-hunt",
      "Build a local research board for crypto launches"
    ),
    values: valuesFor("crypto-product-hunt"),
  },
}

// 11. Crypto Radio
export const CryptoRadioPlaying: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("crypto-radio"),
    spec: projectFor("crypto-radio", "Build a live daily crypto radio"),
    values: valuesFor("crypto-radio"),
    isPlaying: true,
    dataMode: "live",
  },
}

// 12. Crypto Siri
export const CryptoSiriMobile: Story = {
  decorators: [mobile],
  args: {
    preset: presetById("crypto-siri"),
    spec: projectFor(
      "crypto-siri",
      "Build a bilingual voice-first crypto assistant"
    ),
    values: valuesFor("crypto-siri"),
    dataMode: "live",
  },
}

// Contract coverage for all 48 preset fields and all four options per field.
// The assertion deliberately looks inside category-native product content;
// the removed generic settings strip cannot satisfy this test.
export const EveryPresetOptionChangesNativePreview: Story = {
  decorators: [desktop],
  args: {
    preset: presetById("action-engine"),
    values: valuesFor("action-engine"),
  },
  render: () => <NativeFieldOptionContract />,
  play: async ({ canvasElement }) => {
    const nextButton = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Show next native preview option set"]'
    )
    expect(nextButton).not.toBeNull()

    for (let presetIndex = 0; presetIndex < presets.length; presetIndex += 1) {
      const preset = presets[presetIndex]
      for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
        await waitFor(() => {
          const contract = canvasElement.querySelector(
            '[data-testid="native-field-option-contract"]'
          )
          expect(contract?.getAttribute("data-preset-index")).toBe(
            String(presetIndex)
          )
          expect(contract?.getAttribute("data-option-index")).toBe(
            String(optionIndex)
          )

          for (const field of preset.fields) {
            const nativeField = canvasElement.querySelector(
              `[data-preview-field="${field.id}"]`
            )
            expect(nativeField).not.toBeNull()
            expect(nativeField?.textContent).toContain(
              field.options[optionIndex] ?? field.value
            )
          }
        })

        const isLastState =
          presetIndex === presets.length - 1 && optionIndex === 3
        if (!isLastState && nextButton) await userEvent.click(nextButton)
      }
    }
  },
  parameters: {
    docs: {
      description: {
        story:
          "Cycles every option of every preset field and verifies that the selected value is rendered inside the category-native product surface.",
      },
    },
  },
}
