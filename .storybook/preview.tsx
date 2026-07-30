import type { Preview } from "@storybook/nextjs-vite"

import "./preview.css"

const preview: Preview = {
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <Story />
      </div>
    ),
  ],
  parameters: {
    a11y: {
      test: "error",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
  },
}

export default preview
