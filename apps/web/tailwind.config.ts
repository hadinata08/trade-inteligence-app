import type { Config } from "tailwindcss";

// Sistem Nila–Soga (design-demos/direction-approved.md). Kanal oklch disimpan di globals.css
// agar modifier opasitas Tailwind (text-ink/60) tetap bekerja.
const token = (name: string) => `oklch(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: token("ink"),
        paper: token("paper"),
        card: token("card"),
        line: token("line"),
        // Nama lama dipertahankan agar halaman yang belum diubah ikut sistem baru.
        pine: token("ink"),
        copper: token("nila"),
        moss: token("good"),
        clay: token("bad"),
        nila: token("nila"),
        soga: token("soga"),
        canvas: token("canvas"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        // Judul memakai grotesk display, bukan serif (Warm Editorial ditinggalkan).
        serif: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif"],
      },
      boxShadow: {
        card: "none",
      },
    },
  },
  plugins: [],
};

export default config;
