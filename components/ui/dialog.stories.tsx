import type { Meta, StoryObj } from "@storybook/nextjs-vite"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function DialogExample({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        Open connections
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription>
            Connect an external service to this project.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

const meta = {
  title: "UI/Dialog",
  component: DialogExample,
  tags: ["autodocs"],
} satisfies Meta<typeof DialogExample>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
}
