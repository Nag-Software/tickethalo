# TH Scanner — App Store-tekster

Brukt ved innsendingen av versjon 1.0. Språk: engelsk (appen er på engelsk).

## Navn
Tickethalo Scanner

## Undertittel (maks 30 tegn)
Door check-in for clubs

## Kampanjetekst (maks 170 tegn)
Check guests in at the door in seconds. Scan the QR code on their Tickethalo ticket and get a clear yes or no.

## Beskrivelse
Tickethalo Scanner is the door app for clubs that sell tickets on Tickethalo.

Sign in with your club account, pick tonight's show and start scanning. Point the camera at the QR code on a guest's ticket and the screen tells you what to do:

• Green — let them in
• Orange — already checked in, with the time it happened
• Red — wrong show, refunded or unknown ticket

Guest list
See everyone with a ticket, search by name, email or ticket code, and check guests in by hand when they don't have their ticket ready. Made a mistake? Undo a check-in with a swipe.

Built for the door
• Works in the dark, with a flashlight for dim venues
• Type the code when a phone screen won't scan
• Several phones can scan the same show — the count stays in sync
• The screen stays on while you scan

You need a Tickethalo club account with access to the club's shows (owner, admin or staff). Accounts are created by the club in the Tickethalo admin portal.

## Nøkkelord (maks 100 tegn)
tickets,check-in,door,scanner,QR,guest list,events,comedy,club,venue,box office

## URL-er
- Støtte-URL: https://tickethalo.com
- Markedsførings-URL: https://tickethalo.com
- Personvern-URL: https://tickethalo.com/personvern

## Kategori
Primær: Business. Sekundær: Productivity.

## Opphavsrett
2026 Casper Nag

## Aldersgrense
4+ (ingen av kategoriene i spørreskjemaet gjelder).

## Pris
Gratis, alle land.

## App Privacy
Data collected — linked to the user, not used for tracking:
- Contact info → Email address (App Functionality: sign-in)
- Contact info → Name (App Functionality: shown in the account)
Ingen sporing. Ingen tredjeparts analyse eller reklame.

## Merknad til App Review
This app is for staff at clubs that sell tickets on Tickethalo (tickethalo.com). It only works with a club account, so please use the demo account below.

After signing in, open a show and use "Type code" to check in a ticket without the camera, or switch to "Guests" to see the guest list and swipe to check someone in. The camera is used only to read QR codes on tickets.

## Skjermbilder (6,9 tommer, 1320 × 2868)
1. `screenshots/1-shows.png` — showlisten
2. `screenshots/2-guests.png` — gjestelisten
3. `screenshots/3-checked-in.png` — «Let them in»
4. `screenshots/4-already-in.png` — «Already checked in»

Laget i demomodus (`TICKETHALO_DEMO=1`) med oppdiktede klubber og gjester.

## Header-bilde (5244 × 2950)
`header-5244x2950.png`. Kilde: `header-source/header.html`. Rendres med headless Chrome
etter at `logo-white.png` (fra `public/logo/dark/logo.png`) og skjermbildene
`2-guests.png` og `3-checked-in.png` er kopiert inn ved siden av:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --hide-scrollbars --force-device-scale-factor=1 --window-size=5244,2950 \
      --virtual-time-budget=8000 --screenshot=header.png file://$PWD/header.html
