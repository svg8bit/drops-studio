import type { Meta, StoryObj } from "@storybook/nextjs-vite"

import { Input } from "@/components/ui/input"

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    "aria-label": "Project name",
    placeholder: "Name your project",
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Populated: Story = {
  args: {
    defaultValue: "Prediction dashboard",
  },
}

export const Mobile: Story = {
  decorators: [
    (StoryComponent) => (
      <div className="w-[390px] max-w-full">
        <StoryComponent />
      </div>
    ),
  ],
}

export const Desktop: Story = {
  decorators: [
    (StoryComponent) => (
      <div className="w-[640px] max-w-full">
        <StoryComponent />
      </div>
    ),
  ],
  args: {
    defaultValue: "Prediction dashboard",
  },
}

export const Invalid: Story = {
  args: {
    "aria-invalid": true,
    defaultValue: "",
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: "Unavailable",
  },
}
