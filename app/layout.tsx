import type { Metadata } from "next";
import { Geist_Mono, Host_Grotesk } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";

const hostGrotesk = Host_Grotesk({ subsets: ['latin'], variable: '--font-sans' });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tickethalo",
  description: "Tickethalo - Your source for the best comedy events",
  // Peker på public/logo i stedet for å bruke app/icon.png-konvensjonen:
  // de samme filene brukes også som <Image> ute på sidene, og to kopier av
  // det samme merket ville før eller siden kommet ut av synk.
  //
  // Rekkefølgen er ikke tilfeldig. SVG-en først: den har begge variantene
  // inni seg og velger selv på `prefers-color-scheme`, så fanen følger
  // systemtemaet i Chrome, Edge og Firefox. PNG-ene ligger etter som
  // fallback for nettlesere uten SVG-favicon — der gjør `media` jobben når
  // den leses, og når den ikke leses lander man på et merke som er riktig
  // tegnet, bare ikke nødvendigvis i riktig variant.
  //
  // Merk at dette er systemets lys/mørk-modus, ikke sidens egen: flatene her
  // styres av `data-tone` på `.ev-surface` og er lyse uansett hva OS-et sier.
  // Fanen tilhører nettleseren, og der er det systemtemaet som gjelder.
  icons: {
    icon: [
      { url: "/logo/icon.svg", type: "image/svg+xml" },
      {
        url: "/logo/light/icon.png",
        type: "image/png",
        sizes: "210x210",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/logo/dark/icon.png",
        type: "image/png",
        sizes: "210x210",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    // iOS legger ingen bunn bak ikonet selv, så denne er bygget med cream
    // under merket — se scripts/build-brand-icons.mjs.
    apple: { url: "/logo/apple-icon.png", type: "image/png", sizes: "180x180" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // Var "en". Med engelsk språkkode leser skjermlesere norsk tekst med
      // engelsk uttale — WCAG 3.1.1, og i praksis uforståelig.
      lang="nb"
      className={cn("h-full", "antialiased", geistMono.variable, "font-sans", hostGrotesk.variable)}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors closeButton position="top-right" />
        <Analytics />
      </body>
    </html>
  );
}
