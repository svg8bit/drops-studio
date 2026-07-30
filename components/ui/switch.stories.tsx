import type { Meta, StoryObj } from "@storybook/nextjs-vite"

import { Switch } from "@/components/ui/switch"

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: {
    "aria-label": "Enable live preview",
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}

export const Checked: Story = {
  args: {
    defaultChecked: true,
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}
