import type { Meta, StoryObj } from "@storybook/nextjs-vite"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function SelectExample({ disabled = false }: { disabled?: boolean }) {
  return (
    <Select defaultValue="web" disabled={disabled}>
      <SelectTrigger aria-label="Project type" className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Project type</SelectLabel>
          <SelectItem value="web">Web application</SelectItem>
          <SelectItem value="game">Crypto game</SelectItem>
          <SelectItem value="agent">AI agent</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

const meta = {
  title: "UI/Select",
  component: SelectExample,
  tags: ["autodocs"],
} satisfies Meta<typeof SelectExample>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}
