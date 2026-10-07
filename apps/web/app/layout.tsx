import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "HELM Simulation",
  description: "Launcher shell for the HELM control-room simulation game."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="web-shell">
          <header className="web-header">
            <div>
              <span className="web-eyebrow">HELM</span>
              <strong>Agent Operations</strong>
            </div>
            <nav>
              <Link href="/">Overview</Link>
              <Link href="/play">Play</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
