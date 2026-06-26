import type { Metadata, Viewport } from "next";
import { Geist_Mono, Host_Grotesk, Poppins, DM_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { getPublicAppUrl } from "@/lib/app-url";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";

const hostGrotesk = Host_Grotesk({ subsets: ['latin'], variable: '--font-sans' });

// Vipps-inspired public typography: Poppins for headings, DM Sans for body/UI.
// Exposed as CSS variables and applied only within `.public-shell` (see globals.css),
// so admin-app and superadmin keep Host Grotesk.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Lets relative canonical / Open Graph URLs in child routes resolve to the
  // production origin instead of localhost. Required by Next 16 for any
  // relative URL-based metadata field.
  metadataBase: new URL(getPublicAppUrl()),
  title: "humor.events",
  description: "Finn stand-up og komikk i Norge — velg komiklubb og se neste forestilling.",
};

export const viewport: Viewport = {
  themeColor: "#ff5b24",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nb"
      className={cn(
        "h-full",
        "antialiased",
        geistMono.variable,
        "font-sans",
        hostGrotesk.variable,
        poppins.variable,
        dmSans.variable,
      )}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors closeButton position="top-right" />
        <Analytics />
      </body>
    </html>
  );
}
