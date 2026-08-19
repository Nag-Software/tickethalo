# Systemanalyse: enklere og mer sømløst Tickethalo

## Retning

Tickethalo bør føles som et profesjonelt bookingsystem der hver brukerflate har ett tydelig ansvar:

- Admin oppretter show, setter krav og følger status.
- Systemet matcher, sender tilbud, fyller lineup og publiserer når showet er klart.
- Artist svarer på tilbud, holder profilen oppdatert og ser bekreftede bookinger.
- Publikum ser publiserte events, kjøper billett og får QR-billett.

Dette betyr at funksjoner som ikke støtter neste handling direkte bør fjernes fra primærflaten, flyttes til admin eller vente til de er klare som helhetlige moduler.

## Gjort nå

Artistpanelet er forenklet til kjerneflyten:

- Oversikt
- Profil
- Tilgjengelighet
- Tilbud
- Bookinger

Fjernet fra artistopplevelsen:

- Economy
- Invoices
- Settings
- intern adminscore, energi, tags og flagg fra artistprofilen

Rutene finnes fortsatt som redirects for å unngå døde lenker fra historikk eller gamle bokmerker, men de er ikke lenger en del av produktflaten.

## Hva bør være hovedtrekkene videre

### 1. Bookingmotoren som systemets kjerne

Behold og prioriter:

- show med krav
- AI-vurderte artister
- automatisk matching
- tilbud per artist
- artist-aksept som fyller lineup
- databasebeskyttet race condition
- en artist kan kun ha én spot per show
- fullbooket show publiseres automatisk

Dette er produktets viktigste differensiering.

### 2. KI-funksjonalitet som beslutningsstøtte

Behold KI, men gjør den tydelig avgrenset:

- AI vurderer artistprofil og foreslår score, energi og tags.
- Admin tar endelig beslutning.
- AI genererer plakat når lineup er klar.
- AI bør ikke være synlig som intern scoring for artistene.

Neste beste forbedring er en enkel AI-status i admin: `pending`, `completed`, `failed`, med mulighet til å kjøre vurdering på nytt.

### 3. Artistpanelet skal være lett

Artistpanelet bør ikke ha økonomi, faktura, avanserte innstillinger eller interne vurderingsfelter før disse modulene er fullverdige.

Best-practice artistflyt:

1. Se om profilen er klar for booking.
2. Svar på aktive tilbud.
3. Se kommende bookinger.
4. Oppdater offentlig profil.
5. Prioriter relevante datoer.

Alt annet bør enten automatiseres eller håndteres av admin.

### 4. Adminpanelet bør bli en operasjonell cockpit

Adminpanelet bør ikke ha mange manuelle nødknapper på showdetaljer. Det bør vise:

- status per show
- krav og fyllgrad
- sendte tilbud og svar
- automasjonslogg
- hvorfor et show ikke er fullbooket
- hvorfor Facebook/poster/publisering eventuelt feilet

Neste beste forbedring er en `automation_events`-tabell eller enkel logg som viser hva systemet gjorde og hvorfor.

### 5. Markedsføring bør være automasjon med tydelige integrasjonsgrenser

Behold:

- publiser eventside
- aktiver billettsalg
- generer plakat
- Facebook-post hvis credentials finnes

Vent med eller flytt ut av primær-UI:

- Facebook-grupper
- kalenderpartnere
- e-postkampanje

Disse bør først bli egne ekte integrasjoner eller tydelig markeres som manuelle tasks i admin.

## Teknisk best-practice neste steg

### Datamodell og constraints

Prioriter flere database-invarianter:

- en artist per show er allerede lagt til
- unike aktive offers per artist/show
- krav kan ikke ha quantity under aktive spots
- publisert show må ha billettpris, kapasitet og minst én confirmed spot

### Bakgrunnsjobber

Automatikk som poster til Facebook, genererer plakat og sender mange e-poster bør etter hvert flyttes til kø/jobber. Server actions bør starte jobben og lagre status, ikke gjøre alt synkront.

### State machine

Showstatus bør behandles som en eksplisitt state machine:

- `draft`
- `booking`
- `fullbooked`
- `published`
- `completed`
- `cancelled`

Alle overganger bør gå gjennom én funksjon, slik at UI, RPC og automasjon ikke kan sette inkonsistente statuser.

### Observability

Legg til adminsynlig logg for:

- tilbud sendt
- artist akseptert
- lineup full
- plakat generert
- Facebook-post forsøkt
- event publisert
- billettmail sendt
- webhook fullført

Dette gjør systemet mer profesjonelt fordi admin kan se hva som skjer uten å feilsøke i terminal/logs.

## Anbefalt prioritet

1. Rydd admin showdetaljer videre til en ren status-/krav-/lineup-visning.
2. Legg til automasjonslogg.
3. Samle showstatus-overganger i én servicefunksjon.
4. Legg databaseconstraint for aktive offers per artist/show.
5. Flytt Facebook/poster/e-postautomatisering til jobbstatus når MVP-en vokser.
6. Lag korte smoke-tests for bookingflyt, Stripe finalisering og artist-aksept.
