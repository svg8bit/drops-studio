import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "optional",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const configuredProductionUrl =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
  "drops-studio.vercel.app";
const productionUrl = /^https?:\/\//i.test(configuredProductionUrl)
  ? configuredProductionUrl
  : `https://${configuredProductionUrl.replace(/^\/+/, "")}`;

export const metadata: Metadata = {
  metadataBase: new URL(productionUrl),
  title: "Drops Studio — Build crypto apps 10x faster with AI",
  description:
    "Plan, build, test and publish editable crypto applications with DropsTab intelligence, Drops Bot automation and the AI model you choose.",
  openGraph: {
    title: "Drops Studio",
    description: "Build editable crypto applications with AI, DropsTab intelligence and Drops Bot automation.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1536,
        height: 1024,
        alt: "Drops Studio crypto product builder",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Drops Studio",
    description: "Build editable crypto applications with AI, DropsTab intelligence and Drops Bot automation.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
