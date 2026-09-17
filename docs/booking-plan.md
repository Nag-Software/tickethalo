# Plan: nytt bookingoppsett

**Mål:** klubbene får lineups automatisk, og lineupene er gode og som bestilt.

Planen er delt i sju faser som kan rulles ut hver for seg. Hver fase sier hva som endres i databasen, motoren, grensesnittet og de faste jobbene, hvordan den testes, og når den er ferdig. Skrevet 17. september 2026.

## Prinsipper

1. **Krav kvalifiserer, score prioriterer.** En komiker får bare tilbud når hen oppfyller alle kravene: på klubbens liste, godkjent, ikke flagget, riktig rolle, energi og kjønn, ikke utilgjengelig den dagen, og ikke booket på et annet show samme kveld. Scoren avgjør bare rekkefølgen.
2. **De beste får sjansen først.** Tilbudene går ut i bølger, ikke til alle samtidig.
3. **Motoren lemper aldri på kravene selv.** Kommer den ikke videre, sier den fra til bookeren.
4. **Et show publiseres bare med full lineup.**
5. **Bookerens valg vinner.** Et tilbud bookeren har sendt selv, holder setet.

## Allerede gjort

- Migrasjonene fra branchen `new-poster` ligger i repoet, så `main` kan gjenskape produksjonsbasen.
- Når en plass blir full, får de andre ubesvarte tilbudene `filled_by_other` igjen (migrasjon 049).
- Tilbud bookeren sender selv, merkes `manual`. Motoren trekker dem ikke fordi komikeren ikke matcher plassen, og sender ikke setet til andre mens de venter (migrasjon 050 og `lib/booking-rules.ts`).

Migrasjonene er kjørt i produksjon, men koden ligger bare i commit `d99cc1f` lokalt. **Den må pushes til `main` før den virker.** Til da merkes ingen tilbud som manuelle.

## Før vi starter

- **Egen utviklingsdatabase.** `.env.local` peker på produksjonsbasen. Alt i denne planen bør prøves mot en egen database først.
- **Hver fase rulles ut i tre steg,** fordi en push til `main` deployer rett til produksjon:
  1. Utvid: nye tabeller og kolonner. Ingenting fjernes.
  2. Push koden.
  3. Krymp: fjern det gamle, først når koden som ikke bruker det er ute.
- **Fase 4 og 6 tar i komikersidene i admin**, som en annen økt jobber i nå.

## Fase 1 – Fundament

### Score kvalifiserer ikke lenger
- Fjern `MIN_BOOKABLE_SCORE` (`lib/artist-readiness.ts`) og sjekken i motorens filter (`lib/actions/booking.ts`).
- Fjern fallback: `selectFallbackCandidates` og bruken av den. Den finnes bare for å senke scorekravet.
- Fjern minstescore per plass: steget i veiviseren (`requirements-tab.tsx`), «Score X» i lineup-fanen, feltet i `getRequirementWriteInput` og `cloneShowAction` (`shows/actions.ts`), `lib/lineup-defaults.ts` og typen.
- Forslaget om å åpne energinivå (`shows/[id]/page.tsx`) bruker `matchesHardRequirements` fra `lib/booking-rules.ts` i stedet for sin egen kopi av reglene med 6-grensen.

### Sperre mot dobbeltbooking
- **Kollisjon:** komikeren har en bekreftet plass på et annet show samme dato, og showene starter mindre enn 3 timer fra hverandre. Mangler starttid på ett av dem, gjelder hele dagen. Tre timer gjør at to spots på én kveld fortsatt går.
- Motoren: komikere med kollisjon er ikke kandidater.
- Bookerens veier (send tilbud, legg til direkte, bytt komiker, godta søknad) avvises med tydelig melding. Sjekken legges i `assertArtistBookableForShow` (`lib/club-artists.ts`), og velgeren i lineupen viser «Booket samme kveld».
- Ja til tilbud: ny `accept_booking_offer` låser på komikeren i stedet for show og komiker, svarer `conflict` ved kollisjon, og trekker komikerens ubesvarte tilbud på kolliderende show når et ja går gjennom. De komikerne får e-post. Tilbudssiden og portalen viser `conflict`.
- Ubesvarte tilbud på to show samme kveld er lov. Det er ja-et som avgjør.

### Rotasjon i klubben i stedet for straff for å være travel
- Fjern `buildBusyMap`, som trekker 15 poeng per booking i alle klubber.
- Ny straff: −10 poeng per bekreftet plass komikeren har på show i **samme klubb** innenfor 30 dager før eller etter showdatoen. Publikum får variasjon, og komikeren straffes ikke for å jobbe andre steder.

### Knappest først
- Fjern den faste rollerekkefølgen (`requirementRolePriority`). Plassen med færrest kandidater velger først, deretter lavest `lineup_position`. I dag tar Host de beste før Headliner.

### Lik poengsum
- Den som har ventet lengst siden forrige plass i klubben først (aldri spilt der teller som lengst), deretter komikerens id. I dag avgjør databasens rekkefølge.

### Database
- Utvid: `booking_scoring_config` får `rotation_penalty` (10), `rotation_window_days` (30) og `conflict_window_hours` (3). Ny `accept_booking_offer`.
- Krymp: fjern `show_requirements.min_score`, og `fallback_limit`, `busy_penalty_per_booking`, `busy_window_days` og `role_match_bonus` fra `booking_scoring_config`. Rollebonusen gir alle kandidater det samme og betyr ingenting.

**Tester:** kollisjonsregelen, rotasjonsstraffen, rekkefølgen ved lik poengsum og knappest først, i `tests/unit/booking/booking-rules.test.ts`.

**Ferdig når:** ingen komiker kan bli bekreftet på to kolliderende show, og verken plass eller komiker stoppes av score.

## Fase 2 – Publisering bare med full lineup

- Fjern «Publish lineup»-knappen (`lineup-tab.tsx`), `publishLineupAction` og `force` i `automateFullbookedShow`.
- Fjern handlingene som ikke brukes i grensesnittet, men som kan publisere eller gå utenom flyten: `publishShowAction`, `updateShowStatusAction`, `confirmLineupAction`, `bookShowAction`, `sendFallbackOffersAction`, `sendFallbackOffersForShow`, `removeSpotAction` og `updateSpotAction`.
- **Databasevakt:** en trigger på `shows` avviser overgang til `published` når showet mangler plasser, eller en plass mangler bekreftet komiker.
- Markedsføringsoppgavene opprettes ved publisering (`automateFullbookedShow`), ikke bare når siste plass fylles med et ja. I dag får et show som fylles ved at bookeren legger til en komiker direkte, ingen oppgaver.
- Vil klubben kjøre med færre komikere, sletter bookeren plassen. Da er lineupen full, og showet publiseres.
- **Faller en komiker fra etter publisering,** blir showet stående publisert (billettene er solgt), og motoren fyller plassen igjen. Den jobber på publiserte show med ledige plasser, og søknader er åpne for dem.
- Rett teksten «Published with open spots» til at en komiker har falt fra og at plassen fylles igjen. Rett også «The lineup is ready!», som lover plakat automatisk selv om plakat er avslått som standard.

**Tester:** vakten i koden, og at automatisk publisering skjer når siste plass fylles, uansett hvilken vei den ble fylt.

**Ferdig når:** det finnes ingen vei til `published` med ledige plasser, heller ikke rett i databasen.

## Fase 3 – Utilgjengelige datoer

Erstatter de tre ledige datoene i hele systemet.

### Database
- Utvid: ny tabell `artist_unavailable_dates` (komiker, dato, unik per komiker og dato, indeks på dato). RLS: komikeren styrer sine egne rader, admin leser.
- Krymp: fjern `artist_availability`, triggeren `artist_availability_max_three`, funksjonen `enforce_artist_availability_limit` og `availability_bonus` i `booking_scoring_config`. De fire fremtidige markeringene som finnes i dag, forsvinner. De betyr det motsatte og kan ikke gjøres om.

### Komikerportalen
- Ny side `/artist-app/availability`, lagt inn i toppmenyen (`components/artist/artist-topbar.tsx`). Gamle `/artist-app/available-dates` sender dit.
- Kalender bygget på `components/ui/calendar.tsx` (react-day-picker 10 og date-fns, som allerede er i prosjektet):
  - Trykk på en dag veksler mellom utilgjengelig og tilgjengelig.
  - Trykk og dra maler flere dager. Alle dagene får samme tilstand som den første fikk. Fungerer med mus og touch (pointer events, `touch-action: none` på rutenettet).
  - Shift-klikk markerer et spenn.
  - Uken starter på mandag, og to måneder vises side om side på bred skjerm.
  - Dager som har vært, er låst.
  - Dager med bekreftet booking er markert og kan ikke settes utilgjengelige: «Du er booket denne kvelden. Ta kontakt med klubben.»
  - Dager med ubesvart tilbud krever bekreftelse: markerer komikeren dagen, takker hen samtidig nei.
  - Lagres fortløpende etter hvert trykk og hvert dra, med melding hvis noe feiler.
- Én handling, `saveUnavailableDatesAction({ add, remove })` i `app/artist-app/actions.ts`: validerer datoene, avviser dager med bekreftet booking, og takker nei til tilbud på dager som blir utilgjengelige, gjennom den vanlige nei-flyten.
- Fjern `toggleAvailabilityAction`, den gamle siden og typen `ArtistAvailability`.

### Motor og booker
- Utilgjengelig på showdatoen er et hardt krav.
- Velgeren i lineupen viser «Utilgjengelig», og bookerens veier avviser, som ved kollisjon.
- Søknader: plasser på dager komikeren har markert, vises ikke, og søknaden avvises (`lib/open-spots.ts`).

### E-post
Lenkene til `/available-dates` (godkjenningsmailen i `lib/actions/artist.ts`, nei-kvitteringen i `lib/actions/booking.ts` og `lib/email/templates.ts`) peker til kalenderen.

**Tester:** motorens filter, handlingen (booking blokkerer, tilbud avslås) og male-logikken som komponenttest.

**Ferdig når:** komikere får aldri tilbud på en dag de har markert, og ingenting refererer til ledige datoer.

## Fase 4 – Tilbud i bølger

### Regler
- **Mål per ledig sete:** `min(10, 2 × dag)`, der dag 1 er dagen automatikken startet på plassen, regnet i norsk tid. Hver morgen øker målet med 2.
- Motoren sender `mål − aktive tilbud fra motoren`, i poengrekkefølge. Målet gjør at kjøringen kan skje så ofte den vil uten å sende for mange. Sier noen nei, går tilbudet til neste med en gang.
- **Hastemodus:** fra 5 dager før lineup-fristen, og etter fristen, er målet 10.
- **Svarfrist:** 7 døgn, men aldri senere enn lineup-fristen. Etter fristen: 48 timer, og aldri senere enn dagen før showet. På showdagen sender motoren ikke nye tilbud, men varsler bookeren.
- **Lineup-frist:** 14 dager før showet som standard, settes per klubb på «Min klubb».
- Manuelle tilbud holder setet, som nå.

### Når motoren starter på en plass
- Motoren jobber bare på plasser med `auto_started_at`. Den settes av Start booking, når en plass legges til i et show som allerede er startet, og når en plass lukkes for søknader.
- Den settes på nytt når en plass åpnes igjen etter at en komiker er fjernet, slik at de beste får sjansen først også da. `sendOffersForReopenedRequirement` kan da fjernes, men e-posten «Ledig spot» beholdes for de plassene.
- Et manuelt tilbud i et utkast starter ikke automatikken.

### Daglig kjøring
- Ny rute `/api/cron/booking` erstatter `publish-fullbooked` og gjør fire ting: merker utløpte tilbud, kjører motoren for alle show med ledige plasser, sender påminnelser, og publiserer show som er fylt.
- Kjøres hver morgen kl. 06:00 UTC fra `.github/workflows/run-automation.yml`, så tilbudene lander til frokost og ikke midt på natten.
- Registrering av en ny komiker kjører ikke lenger motoren for alle show på plattformen. I stedet kjøres motoren for klubbens show når klubben legger en komiker på listen (`connectArtistAction`) eller endrer rolle eller energi (`saveClubArtistReviewAction`).

### Påminnelse
- E-post til komikeren når det er under 48 timer igjen av fristen, én gang per tilbud, og bare for tilbud med mer enn 3 døgns frist. Ny mal og `sendOfferReminderEmail`.

### Database (utvid)
- `show_requirements.auto_started_at`, satt til nå for plasser i show som er i booking eller publisert med ledige plasser.
- `booking_offers.reminded_at`.
- `clubs.lineup_deadline_days` (14).
- `booking_scoring_config`: `offers_per_day` (2), `offer_response_days` (7), `rush_days` (5), `reminder_hours` (48) og `late_offer_response_hours` (48).

**Tester:** målet per dag og i hastemodus, svarfristen rundt lineup-fristen og showdagen, og hvem som får påminnelse.

**Ferdig når:** et nytt show sender til de 2 beste per sete første dag, trapper opp til 10 over fem dager, og bytter ut utløpte og avslåtte tilbud uten at noen gjør noe.

## Fase 5 – «Trenger oppmerksomhet»

Tabell øverst på `/admin-app/shows`, over filtrene, skjult når den er tom.

- **Kolonner:** nivå, show og dato, plass, hva som er galt, og en handling som lenker til riktig fane.
- **Sortering:** nivå, deretter showdato.
- **Beregning:** ved sidevisning, for klubbens kommende show. Ingen ny tabell. Logikken ligger i `lib/booking-attention.ts` som en ren funksjon med tester, og kandidattellingen bruker de samme reglene som motoren (`lib/booking-rules.ts`), så varslene ikke kan si noe annet enn det motoren gjør.

| Nivå | Varsel | Handling |
|---|---|---|
| Kritisk | **Ingen kandidater.** Ingen på listen oppfyller kravene. Viser hvilket krav som stenger, og hvor mange som matcher om det lempes | Lemp kravet, hent komikere fra Discover, send tilbud selv, åpne for søknader |
| Kritisk | **Kandidatene er brukt opp.** Alle som oppfyller kravene har fått tilbud på showet eller er tatt av det, og ingen tilbud venter | Samme |
| Kritisk | **Lineup-fristen er passert** med ledige plasser | Fyll selv, eller slett plassen |
| Kritisk | **Fylt, men kan ikke publiseres.** Klubbens Stripe-oppsett mangler | Fullfør Økonomi |
| Kritisk | **Publisert show har fått en ledig plass** | Følg med, og oppdater plakaten |
| Advarsel | **Lineup-fristen er nær** (5 dager eller mindre) med ledige plasser | Følg med, eller fyll selv |
| Advarsel | **Utkast** der lineup-fristen er under 14 dager unna | Start booking |
| Advarsel | **Bookerens eget tilbud har ventet over 3 døgn** og holder setet | Trekk tilbudet, så tar motoren over |
| Advarsel | **Tre eller flere nei på samme plass** | Sjekk honorar og krav |
| Oppfølging | **Søknader venter på svar** | Svar |
| Oppfølging | **Showet er spilt, lineupen ikke vurdert** | Vurder |

**Tester:** hvert varsel, både rader som skal utløse det og rader som ikke skal.

**Ferdig når:** bookeren ser alt automatikken ikke klarer, uten å åpne hvert enkelt show.

## Fase 6 – Vurdering etter show

### Scoren
- Verdier: svakt 0, middels 5, sterkt 10. «Avlyste / møtte ikke» er 0 og teller som to vurderinger.
- Score = snittet av de siste 10 vurderingene, på tvers av klubber. Har komikeren færre enn 3, fylles resten opp med 5.
- Alle settes til 5,0 når dette innføres, ellers beholder de to som har 8 i dag et forsprang ingen har fortjent.
- Regnes på nytt hver gang en vurdering lagres eller endres, med en ren funksjon i `lib/artist-score.ts`.

| Vurderinger | Score |
|---|---|
| Ingen | 5,0 |
| Sterkt | 6,7 |
| Sterkt, sterkt | 8,3 |
| Sterkt × 3, så middels | 8,8 |
| Sterkt × 5, så avlyste | 7,1 |
| Svakt, svakt | 1,7 |

### Database
- Gjenbruk `artist_performance_reviews`, som allerede finnes i produksjon og er tom: fjern `score`, legg til `rating` (`weak`, `medium`, `strong`, `no_show`) og `reviewed_by`. Én vurdering per bekreftet plass, lagret med show og klubb.
- `artists.admin_score` blir desimaltall (`numeric(3,1)`) med 5 som standard.

### Grensesnitt
- Showsiden får «Vurder lineupen» når showet er spilt: én rad per komiker, fire valg og et valgfritt notat. Kan endres i 30 dager.
- «Fjern fra lineupen» får valget «Komikeren avlyste», som lagrer en avlyst-vurdering.
- Scoren vises i klubbens komikerliste og i velgeren i lineupen, for eksempel «7,5 · 6 vurderinger», så bookeren ser hvorfor motoren prioriterer som den gjør.
- Varselet i fase 5 står til alle er vurdert.

**Global nå, per klubb senere.** Vurderingen lagres med klubben, så scoren kan regnes per klubb den dagen flere klubber deler de samme komikerne.

**Tester:** scorefunksjonen mot tabellen over, og at bare klubbens egne show kan vurderes.

**Ferdig når:** en spilt lineup vurderes med ett trykk per komiker, og scoren endrer seg med en gang.

## Fase 7 – Opprydding

- Fjern booking-restene fra `new-poster` som ingenting bruker: `club_booking_settings`, `artist_club_scores` (5 rader), `show_requirements.booking_mode` og funksjonen `insert_sent_offer_if_capacity`. Dette sletter data og bør bekreftes særskilt.
- Oppdater `docs/booking-pipeline.md` til det nye oppsettet.

## Motoren etter endringene

**Krav, alle må være oppfylt:** på klubbens liste og ikke flagget · godkjent · rolle · energi · kjønn · ikke utilgjengelig den dagen · ingen kollisjon med en annen booking · ikke involvert i showet fra før (ja, nei, utløpt, aktivt tilbud, eller tatt av bookeren).

**Poeng:** `score × 10 − 10 × bekreftede plasser i samme klubb innen 30 dager`. Ved lik sum: lengst siden forrige plass i klubben, deretter id.

| Innstilling | Standard | Hvor |
|---|---|---|
| `quality_weight` | 100 | `booking_scoring_config` |
| `rotation_penalty` / `rotation_window_days` | 10 / 30 | `booking_scoring_config` |
| `conflict_window_hours` | 3 | `booking_scoring_config` |
| `offers_per_day` / `offers_per_slot` | 2 / 10 | `booking_scoring_config` |
| `offer_response_days` / `late_offer_response_hours` | 7 / 48 | `booking_scoring_config` |
| `rush_days` | 5 | `booking_scoring_config` |
| `reminder_hours` | 48 | `booking_scoring_config` |
| `lineup_deadline_days` | 14 | `clubs` |

**Fjernet:** `availability_bonus`, `role_match_bonus`, `busy_penalty_per_booking`, `busy_window_days`, `fallback_limit`, `show_requirements.min_score` og `artist_availability`.

## Migrasjoner

| Nr | Fase | Type | Innhold |
|---|---|---|---|
| 051 | 1 | Utvid | Rotasjon og kollisjon i innstillingene, ny `accept_booking_offer` |
| 052 | 1 | Krymp | Fjern `min_score` og de gamle innstillingene |
| 053 | 2 | Vakt | Trigger: ingen publisering med ledige plasser |
| 054 | 3 | Utvid | `artist_unavailable_dates` |
| 055 | 3 | Krymp | Fjern `artist_availability` og `availability_bonus` |
| 056 | 4 | Utvid | `auto_started_at`, `reminded_at`, `lineup_deadline_days`, bølgeinnstillinger |
| 057 | 6 | Utvid | Vurderinger, `admin_score` som desimaltall, alle til 5,0 |
| 058 | 7 | Krymp | Fjern restene fra `new-poster` (egen bekreftelse) |

Migrasjon 051 og koden i fase 1 bør kjøres og pushes rett etter hverandre. Den nye funksjonen svarer `conflict`, som den gamle koden ikke kjenner.

## Omfang

| Fase | Kompleksitet |
|---|---|
| 1 Fundament | 4/10 |
| 2 Publisering bare med full lineup | 2/10 |
| 3 Utilgjengelige datoer | 5/10 |
| 4 Tilbud i bølger | 5/10 |
| 5 Trenger oppmerksomhet | 5/10 |
| 6 Vurdering etter show | 4/10 |
| 7 Opprydding | 1/10 |

Rekkefølgen følger avhengighetene: fase 5 bruker reglene fra 1, 3 og 4, og fase 6 fyller ett av varslene i 5. Fase 2, 3 og 6 kan flyttes på.

## Standardverdier jeg har valgt

Disse er ikke avtalt, og kan endres når som helst:

- 3 timer mellom to show før det regnes som kollisjon.
- Lineup-frist 14 dager før showet, hastemodus fra 5 dager før fristen, 48 timers svarfrist etter fristen.
- Påminnelse 48 timer før fristen.
- Rotasjonsstraff 10 poeng per plass i samme klubb innen 30 dager.
- Terskler for varsler: 3 døgn for bookerens eget tilbud, 3 nei på samme plass, 14 dager for utkast.
- Vurderinger kan endres i 30 dager.
