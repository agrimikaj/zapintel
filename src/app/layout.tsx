import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZapIntel — Client Intelligence by Zapsight",
  description:
    "Boardroom-grade prospect intelligence reports. Enter a company, get an 8-dimension brief on who they are, what they need, and where Zapsight fits.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg-primary text-ink-primary antialiased">{children}</body>
    </html>
  );
}
