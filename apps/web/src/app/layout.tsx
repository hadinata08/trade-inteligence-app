import type { Metadata } from "next";
import { Hanken_Grotesk, Schibsted_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Hanken Grotesk untuk isi, Schibsted Grotesk (berdarah surat kabar) untuk judul.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const display = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Indonesia Trade Intelligence",
  description: "Analitik perdagangan barang internasional Indonesia dari UN Comtrade.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={`${sans.variable} ${display.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
