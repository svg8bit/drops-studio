import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: "Drops Studio — Build crypto products in minutes",
    description: "Build useful crypto apps with DropsTab intelligence, Drops Bot automation and the AI model you choose.",
    openGraph: {
      title: "Drops Studio",
      description: "Turn a crypto idea into a live project in five minutes.",
      type: "website",
      images: [{ url: image, width: 1536, height: 1024, alt: "Drops Studio crypto product builder" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Drops Studio",
      description: "Turn a crypto idea into a live project in five minutes.",
      images: [image],
    },
    icons: {
      icon: "https://dropstab.com/images/dropstab-logo-drop-default.svg",
      shortcut: "https://dropstab.com/images/dropstab-logo-drop-default.svg",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
