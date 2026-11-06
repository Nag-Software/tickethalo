# Tickethalo Scanner (iOS)

Native SwiftUI-app for døra: logg inn med en klubbkonto, velg show, skann billetter.
Ingen avhengigheter — bare SwiftUI, AVFoundation og Supabase Auth over REST.

## Hvordan den henger sammen

- **Innlogging:** Supabase Auth (`/auth/v1/token`) med samme e-post og passord som
  admin-portalen. Tokenet lagres i nøkkelringen og fornyes automatisk.
- **Data:** `app/api/scanner/*` i Next-appen. Appen sender tokenet som
  `Authorization: Bearer …` og valgt klubb som `X-Tickethalo-Club`.
  `getAuthUser` (lib/session.ts) godtar Bearer, så `getClubAccess` og
  `assertShowAccess` gjelder uendret. Innsjekkingen er den samme `checkInByCode`
  som webscanneren bruker.
- **Tilgang:** bare `superadmin`, `owner`, `admin` og `staff` (lib/scanner-api.ts).

| Rute | Hva |
| --- | --- |
| `GET /api/scanner/me` | bruker og klubber |
| `GET /api/scanner/shows` | showene til valgt klubb |
| `GET /api/scanner/shows/:id` | show + billettliste |
| `POST /api/scanner/shows/:id/check-in` `{ code }` | sjekk inn |
| `POST /api/scanner/shows/:id/undo` `{ ticketId }` | angre innsjekking |

## Kjøre lokalt

Åpne `ios/TickethaloScanner.xcodeproj` i Xcode og kjør på en simulator.
Debug-bygg snakker med `http://localhost:3000`. Kjører dev-serveren på en annen
port, sett `TICKETHALO_API_URL` (f.eks. `http://localhost:3030`) under
*Edit Scheme → Run → Environment Variables*. Release-bygg bruker `https://tickethalo.com`.

Simulatoren har ikke kamera — bruk «Type code».

## Til App Store

1. Apple Developer-konto (Nag Software). Sett teamet under *Signing & Capabilities*
   og bekreft bundle-ID-en `com.tickethalo.scanner`.
2. Opprett appen i App Store Connect med samme bundle-ID.
3. Xcode → *Product → Archive* → *Distribute App* → App Store Connect.
4. I App Store Connect:
   - Personvern-URL: personvernsiden på tickethalo.com.
   - App Privacy: e-post og navn (kontoinnlogging), ikke brukt til sporing.
   - **Innloggingsinfo til Apple:** en demokonto (rolle `staff`) i en testklubb med et
     publisert testshow og noen billetter. Uten den avvises appen.
   - Vurder «Unlisted App Distribution» — appen er bare for klubbene.
5. Øk `CURRENT_PROJECT_VERSION` for hver opplasting, `MARKETING_VERSION` per versjon.
