import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klimand",
  description: "Chat-driven orchestration over Claude Code and Codex"
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en" className="dark">
      <body className="h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
