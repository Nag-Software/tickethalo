# Plan for AI-plakatgenereringen

Skrevet 2026-09-18, etter «Backstage Stand Up»-plakaten der Tom Soyler fikk
Jaran Hereids ansikt, Jaran manglet rute, og raden over navnene nederst var
uleselig («Modereng / Supdingu / Suppert»).

## 1. Hva som faktisk gikk galt

Alt peker på samme rotårsak: **ett kall til bildemodellen tegner alt** —
ansikter, navn, dato og sted (`lib/actions/ai.ts`, `requestPosterImage`).
Da er «riktig navn under riktig ansikt» bare en setning i prompten. Ingenting
håndhever den, og ingen prompt-justering gjør den pålitelig.

Konkret på denne plakaten:

1. **Feil ansikt på Tom Soyler.** Lineupen hadde fem komikere, oppsettet fikk
   fire ruter. Modellen droppet Jarans rute, men brukte ansiktet hans i Toms.
   «IDENTITY MAP» er et hint, ikke en sperre.
2. **Kontrollen slapp det gjennom.** `verifyPosterPortraits` avviser bare
   dubletter og *for mange* portretter (`ai.ts:399`). Fire portretter for fem
   komikere passerer. Den sjekker aldri hvem som er hvem, og aldri teksten.
3. **Uleselig tekst.** `generatePosterAction` sender rutenavnet («Host»,
   «Stand-up 2») inn som `role_name`. Modellen prøver å sette dem som en egen
   kredittrad og staver dem i stykker. Bildemodeller staver ikke pålitelig,
   og særlig ikke norsk.
4. **Plakater forsvinner.** `generateShowPoster` laster opp filen og
   overskriver `shows.poster_url`. Ingen rad peker på den forrige, og
   markedsføringsfanen viser bare den gjeldende. Opplastede plakater havner i
   `show_marketing_designs` (kind `poster`), men fanen filtrerer på
   `kind === 'template'`, så heller ikke de kan hentes fram igjen.

## 2. Prinsippet

> AI-en tegner aldri noe som kan være *faktisk feil*.

Ansikter, navn, dato, klokkeslett og sted settes av kode. AI-en lager bare det
som er smak: bakgrunn, tekstur, stemning. Da er navnebytte ikke usannsynlig —
det er umulig, fordi bildet og navnet i en rute kommer fra samme rad.

## 3. Ny pipeline — tre lag

**Lag 1 — Layout (data).** Bilderuter og tekstfelt som normaliserte
koordinater (0–1).
- Innebygde layouter for 1–8 komikere, headliner størst.
- Klubbens mal: ruter og tekstfelt hentes ut **én gang** med en synsmodell,
  klubben bekrefter/justerer i en enkel editor, og resultatet lagres på
  `show_marketing_designs.brand_kit` (kolonnen finnes fra migrasjon 042).

**Lag 2 — Bakgrunn (AI).** Bildemodellen får én jobb: en bakgrunn uten
mennesker og uten tekst, i klubbens palett. For maler: en «ren plate» der
gamle ansikter og gammel tekst er fjernet — laget én gang per mal og cachet.
Platen kontrolleres med «finnes det ansikter eller tekst her?», som er en
sjekk synsmodeller faktisk er gode på.

**Lag 3 — Komposisjon (kode, `sharp`).**
- Hver artists bilde beskjæres inn i sin rute. Navnet rendres fra samme
  ruterad, rett under.
- Tittel, dato, sted og «BILLETTER · TICKETHALO» settes med medfølgende
  fonter (Geist), så æ/ø/å alltid blir riktig. Tekst krympes til den passer;
  passer den ikke på minstestørrelse, feiler genereringen med en tydelig
  melding i stedet for å levere noe uleselig.
- Rollerader («Host») tegnes bare hvis layouten har et felt for dem, og da av
  kode.

Det meste av dette finnes allerede på `origin/new-poster` og kan hentes inn:
`lib/poster-template.ts`, `poster-render.ts`, `poster-compose.ts`,
`poster-extract.ts`, `poster-fonts.ts`, `poster-validation.ts` og
`public/fonts/Geist-*.ttf`. `poster-fonts.ts` løser også at Vercel ikke har
noen systemfonter.

### Regler som erstatter dagens gjetting

- **Flere komikere enn ruter:** aldri dropp noen i det stille. Innebygd
  layout → velg en med nok ruter. Klubbmal med for få ruter → stopp med
  «Malen har 4 ruter, lineupen har 5», og la klubben velge annen mal eller
  hvem som står med bare navn.
- **Komiker uten bilde:** navnet står i lineup-feltet; ingen oppdiktet
  ansikt, ingen tom rute.
- **Kontroll før lagring er deterministisk:** hver bekreftet artist finnes
  nøyaktig én gang, all tekst fikk plass. Ingen synsmodell trengs for det.

### Bivirkninger som er verdt å ta med

- Endres lineupen, rendres plakaten på nytt **uten AI-kall** — sekunder og
  gratis. «Ny bakgrunn» og «oppdater tekst/bilder» blir to ulike knapper.
- Med mal er det null AI-kall per show. I dag er det opptil tre
  høykvalitetskall pluss tre synskall, som også er en timeout-risiko.
- Ærlig avveining: plakaten blir mer «satt» og mindre «malt». Ansiktene er
  ekte bilder i ruter, ikke smeltet inn i motivet. Plakaten over er allerede
  i den stilen, så tapet er lite.

## 3b. Maler: slik beholder klubben merkevaren

Malen er klubbens design. AI-en får aldri tegne den på nytt — og klubben skal
ikke måtte sette opp noe. Alt under skjer av seg selv første gang malen brukes
(`lib/poster/template-setup.ts`).

1. **Feltene finnes** (`analyze.ts`). En synsmodell peker ut bilderuter, navn,
   dato og sted. En jevn rad med ruter blir til ett *fleksibelt lineupfelt*,
   så antallet følger lineupen. En tittel som er et ordmerke (skråstilt,
   flerfarget) blir stående som piksler, og layouten husker hva det står.
2. **Platen lages** (`plate.ts`). Bildemodellen tømmer designet for ansikter,
   navn og datoer. Resultatet brukes bare i og like rundt feltene, der noe
   faktisk ble fjernet; alt annet limes tilbake fra originalfila, piksel for
   piksel. Platen kontrolleres for rester av folk og gammel tekst.
3. **Plakaten settes** av kode, som ellers. Null AI-kall per show etter første
   gang.
4. **Resultatet kontrolleres** (`templatePosterLooksGood`). Dekker et bilde
   logoen, står det igjen rester, kolliderer noe? Da forkastes oppsettet.

Går noe av dette galt — for få ruter, en innebygd tittel som ikke er showets,
et ansikt uten navnefelt, eller en kontroll som sier nei — lages plakaten i
**innebygd layout i klubbens farger** i stedet. Klubben får alltid en riktig
plakat; malen brukes når den også blir pen.

Ærlig status: en ferdig plakat med utklipte figurer som overlapper tittelen
(som «Backstage Stand Up»-plakaten) er et vanskelig utgangspunkt, og faller i
dag tilbake på innebygd layout. En ren designmal med tydelige ruter er det
malsporet er laget for.

## 4. Plakatarkiv

Gjenbruk `show_marketing_designs` i stedet for en ny tabell — opplastede
plakater ligger der allerede.

- Migrasjon: `source text` (`'ai' | 'upload'`), `lineup_snapshot jsonb`
  (artist-id + navn da plakaten ble laget), og `shows.active_poster_design_id`.
  `shows.poster_url` beholdes som den er, fordi alle offentlige sider leser den.
- `generateShowPoster` setter inn en `kind: 'poster'`-rad for hver generering.
  Filen legges i samme bøtte som opplastingene, så sletting virker likt.
- Markedsføringsfanen får «Tidligere plakater»: miniatyrer med dato, kilde og
  «Bruk denne» (`useDesignAsPosterAction` finnes, men må sette riktig
  `poster_source`). Avviker `lineup_snapshot` fra dagens lineup, merkes
  plakaten «lineupen er endret siden».
- «Fjern» og «Generer på nytt» sletter aldri filer. Sletting er en egen,
  eksplisitt handling per plakat.
- **Gjenoppretting:** de «tapte» plakatene er ikke borte. Filnavnet har
  tidsstempel (`poster-${Date.now()}.png`), så hver generering ligger fortsatt
  i `generated-posters/{showId}/`. Et engangsskript lister bøtta og lager
  arkivrader for dem.

## 5. Rekkefølge

| Fase | Innhold | Avhenger av |
|------|---------|-------------|
| 0 | Plakatarkiv: migrasjon, innsetting ved generering/opplasting, «Tidligere plakater», gjenopprettingsskript | — |
| 1 | Kodekomposisjon med innebygde layouter: hent inn filene fra `new-poster`, fonter, layouter 1–8, AI kun for bakgrunn, regler for ruter/bilder, erstatt `verifyPosterPortraits` | — |
| 2 | Klubbmaler: automatisk uttrekk av ruter/tekstfelt, cachet plate, kvalitetskontroll med fallback | 1 |
| 3 | Finpuss: «New background» + arkivet gir varianter å velge mellom. Utklipp per artist ble bygget (MODNet i nettleseren) og **fjernet igjen** etter ønske — plakatene bruker bildene som de er | 1 |

Fase 0 og 1 er uavhengige. Fase 0 er liten og fjerner datatapet med én gang.
Fase 1 fjerner feil ansikt og uleselig tekst. Inntil fase 2 er ferdig bør
«Generer med AI» oppå en klubbmal enten skjules eller merkes som eksperimentell
— det er den veien plakaten over kom fra.

## 6. Tester

Erstatter `tests/unit/marketing/ai-poster.test.ts`:

- Rute *n* får artist *n*s bilde (pikselhash av ruteområdet) og navn *n*.
- Hvert navn forekommer nøyaktig én gang; æ/ø/å overlever.
- Fem artister + layout med fire ruter → feil, ikke stille bortfall.
- Tekst som ikke får plass → feil med melding.
- Bakgrunnsprompten inneholder aldri artistnavn eller bilder.
- Generering setter inn arkivrad; «Bruk denne» bytter `poster_url` uten å
  slette noe.
