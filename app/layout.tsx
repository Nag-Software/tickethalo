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
  // Peker på public/icon.svg i stedet for å bruke app/icon.svg-konvensjonen:
  // samme fil brukes også som <Image> i admin, og to kopier av det samme
  // ikonet ville før eller siden kommet ut av synk.
  icons: { icon: "/icon.svg" },
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
