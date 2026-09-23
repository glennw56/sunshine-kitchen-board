import type { Metadata } from "next";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";

const heading = Fraunces({ subsets: ["latin"], variable: "--font-heading" });
const body = Nunito({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Sunshine kitchen board",
  description: "Bake-day task board for Sunshine's Bakery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
