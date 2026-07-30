import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"
import type { Meta, StoryObj } from "@storybook/nextjs-vite"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"

const meta = {
  title: "UI/Alert",
  component: Alert,
  tags: ["autodocs"],
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = {
  render: () => (
    <Alert className="max-w-lg">
      <CircleCheckIcon />
      <AlertTitle>Project is ready</AlertTitle>
      <AlertDescription>
        The generated files passed validation and can be previewed.
      </AlertDescription>
    </Alert>
  ),
}

export const Connected: Story = {
  render: () => (
    <Alert className="max-w-lg">
      <CircleCheckIcon />
      <AlertTitle>DropsTab connected</AlertTitle>
      <AlertDescription>
        Live market data is available to this project.
      </AlertDescription>
    </Alert>
  ),
}

export const Disconnected: Story = {
  render: () => (
    <Alert className="max-w-lg" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Connection required</AlertTitle>
      <AlertDescription>
        Connect a provider before using this external action.
      </AlertDescription>
    </Alert>
  ),
}

export const Error: Story = {
  render: () => (
    <Alert className="max-w-lg" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Validation failed</AlertTitle>
      <AlertDescription>
        Resolve the reported issues before publishing this project.
      </AlertDescription>
    </Alert>
  ),
}
