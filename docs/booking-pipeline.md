# Booking: fra «Start booking» til publisert lineup

Slik fylles en lineup, lest ut av koden. Dette er den tekniske siden;
[booking-algoritmen.md](booking-algoritmen.md) forklarer det samme uten
filnavn, og [booking-plan.md](booking-plan.md) er planen arbeidet fulgte.

Motoren ligger i `lib/actions/booking.ts`. Reglene den følger står i
`lib/booking-rules.ts` (hvem, og i hvilken rekkefølge) og
`lib/booking-schedule.ts` (når, og hvor mange). Handlingene bak knappene i
admin ligger i `app/admin-app/(protected)/shows/actions.ts`.

## Flyten i korte trekk

1. Bookeren oppretter et show (`draft`) med en standard-lineup.
2. **Start booking** setter showet til `booking` og stempler `auto_started_at`
   på hver plass. Det er dag 1 i bølgen.
3. Motoren sender tilbud på e-post til klubbens egne komikere, litt om gangen.
4. Den første komikeren som sier ja, får plassen.
5. Hvert svar, og hver morgen, kjører motoren på nytt.
6. Når alle plasser er fylt, publiseres showet. Det finnes ingen annen vei dit.

## 1. Plassene og parameterne

Et nytt show får seks plasser: Headliner (15 %), Host (15 %), tre Stand-up
(10 % hver) og Open Mic (0 %). Hver plass er en rad i `show_requirements`:

| Parameter | Betydning |
|---|---|
| `role_name` | Headliner, Host, Stand-up eller Open Mic. Et hardt krav. |
| `quantity` | Antall seter. Standard er 1. |
| `lineup_position` | Rekkefølgen i lineupen. |
| `energy_level` | `any`, `high`, `low` eller `uncertain`. Må stemme eksakt med klubbens vurdering av komikeren. |
| `required_gender` | `any`, `woman`, `man` eller `non_binary`. Sjekkes mot komikerens egen profil. |
| `compensation_*` | Fast beløp eller prosent av billettsalget. |
| `submissions_open` | Plassen tar imot søknader, og motoren lar den være. |
| `auto_started_at` | Når motoren begynte å jobbe på plassen. Null = den rører den ikke. |

**Start booking** krever at hver plass har rolle og honorarmodell, og at
prosentene til sammen ikke overstiger klubbens artistandel
(`artist_share_bps`).

## 2. Hvem som kan få tilbud

Motoren henter kandidater bare fra klubbens egen liste (`club_artists`). En
komiker kan få tilbud på en plass når hen:

- er `approved` på plattformen og ikke flagget av klubben
- har plassens rolle blant rollene *klubben* har satt på hen
- matcher energi og kjønn, med mindre plassen står på `any`
- ikke har markert dagen i `artist_unavailable_dates`
- ikke har en bekreftet plass på et show som starter mindre enn
  `conflict_window_hours` fra dette. Mangler ett av dem starttid, gjelder hele
  dagen
- ikke står i lineupen, og ikke har et sendt, godtatt, avslått eller utløpt
  tilbud på showet (trukne tilbud og tilbud som ble tatt av en annen, teller ikke)
- ikke er ekskludert fra showet. Det skjer når bookeren trekker tilbudet eller
  fjerner komikeren, og oppheves når bookeren velger hen manuelt igjen.

En komiker har aldri mer enn ett aktivt tilbud per show.

**Score er ikke et krav.** Den avgjør bare rekkefølgen. Kravene over lempes
aldri av motoren — bare av bookeren.

## 3. Rangeringen av komikere

Kandidatene sorteres på poeng. Verdiene står i raden `default` i
`booking_scoring_config`, og redigeres på `/superadmin/booking`.

```
poeng = admin_score / 10 × quality_weight        kvalitet
      − rotation_penalty × plasser i samme klubb innen rotation_window_days
```

Med standardverdiene: ti poeng per scorepoeng, minus ett scorepoeng for hver
kveld komikeren allerede har hos *denne* klubben innen 30 dager. Show i andre
klubber teller ikke.

Ved lik sum går den som har ventet lengst siden forrige kveld i klubben
først, og den som aldri har spilt der, aller først. Til slutt komikerens id,
slik at den samme kjøringen alltid gir den samme lineupen.

`admin_score` settes ikke for hånd. Den er snittet av de siste ti
vurderingene etter show — se punkt 9 og `lib/artist-score.ts`.

## 4. Bølgene og rekkefølgen mellom plassene

Plassene konkurrerer om de samme komikerne, så tilbudene doseres:

- **Mål per ledig sete:** `min(offers_per_slot, offers_per_day × dag)`, der
  dag 1 er `auto_started_at`, regnet i norsk tid. Med standardverdiene: to
  tilbud dag 1, fire dag 2, opp til ti.
- **Hastemodus:** fra `rush_days` før lineup-fristen, og etter den, er målet
  hele taket med en gang.
- Motoren sender `mål − aktive tilbud fra motoren`. At det er et *mål* og
  ikke «send så mange nå», gjør at den kan kjøre så ofte den vil.
- **Knappest først:** plassen med færrest kandidater velger først, deretter
  lavest `lineup_position`. Plasser uten kandidater går sist.
- Tilbudene deles ut i runder, så én plass ikke tømmer listen.
- Seter der bookeren har sendt et tilbud selv, regnes ikke med (se punkt 6).

## 5. Tilbudet og svaret

Hvert tilbud blir en rad i `booking_offers` med en lenke
(`/booking-offer/[token]`) som kan besvares uten innlogging. Fast honorar
kopieres inn på tilbudet; prosentavtaler leses fra plassen.

**Fristen** er `offer_response_days`, men aldri lenger enn lineup-fristen og
aldri forbi showet. Er lineup-fristen passert, er den
`late_offer_response_hours`, og aldri senere enn dagen før showet. På
showdagen sender motoren ingenting.

- **Ja:** `accept_booking_offer` (migrasjon 051) låser på komikeren, avviser
  et ja som ville dobbeltbooket hen (`conflict`), og lager en `confirmed_spot`.
  Blir plassen full, settes de andre ubesvarte tilbudene til `filled_by_other`.
  De komikerne kan fortsatt få tilbud på en annen plass på showet. Komikerens
  egne ubesvarte tilbud på kolliderende show trekkes, med e-post.
- **Nei:** Svaret kvitteres på e-post, og motoren tilbyr ikke komikeren showet igjen.
- **Påminnelse:** `reminder_hours` før fristen, én gang per tilbud
  (`reminded_at`), og bare på tilbud som hadde mer enn tre døgns frist.

## 6. Bookerens manuelle grep

- **Send tilbud:** Bookeren velger komikeren selv, også en som ikke matcher
  plassens rolle, energi eller kjønn. Tilbudet merkes `source: 'manual'`:
  motoren trekker det ikke, og sender ikke setet til andre mens det venter på
  svar. Det samme gjelder godkjente søknader og tilbud bookeren flytter.
- **Legg til direkte:** Komikeren settes rett inn i lineupen, uten tilbud.
- **Fjern fra lineupen:** Komikeren tas ut og ekskluderes. Ubesvarte tilbud på
  plassen trekkes, bølgen starter forfra, og neste kjøring sender «Ledig
  spot»-e-post. Valget «Komikeren avlyste» lagrer en `no_show`-vurdering.
- **Trekk tilbud:** Komikeren ekskluderes fra showet, og motoren kjører på nytt.
- **Åpne energinivå:** Plassen settes til `any`, og motoren kjører på nytt.

Kollisjon og utilgjengelig dag kan bookeren *ikke* overstyre. Begge avvises i
`assertArtistBookableForShow` (`lib/club-artists.ts`).

## 7. Søknader

En plass med `submissions_open` fylles av komikere som søker, ikke av
motoren. Per show velger bookeren hvem som kan søke (`roster` eller
`everyone`), og en eventuell frist. Plasser på dager komikeren har markert,
vises ikke, og søknaden avvises. Lukker bookeren plassen for søknader, tar
motoren over og bølgen starter.

## 8. Publisering

`automateFullbookedShow` setter showet til `published`, og da åpner
billettsalget. Det skjer bare når **hver plass har en bekreftet komiker**.
Vil klubben kjøre med færre, sletter bookeren plassen.

En trigger på `shows` (migrasjon 053) avviser overgangen til `published` med
ledige plasser, også fra en konsoll. Publisering krever i tillegg at klubbens
Stripe Connect-oppsett er ferdig. Markedsføringsoppgavene opprettes ved
publisering, uansett hvilken vei siste plass ble fylt.

Faller en komiker fra etterpå, blir showet stående publisert — billettene er
solgt — og motoren fyller plassen igjen. Den jobber på `booking`,
`fullbooked` og `published`.

**Daglig kl. 06:00 UTC** kaller `run-automation.yml` `/api/cron/booking`, som
merker utløpte tilbud, kjører motoren for alle show med ledige plasser,
publiserer dem som er fylt, og sender påminnelser.

## 9. Etter showet

Dagen etter gjøres honorarene opp (`lib/artist-fees.ts`), og lineupen dukker
opp igjen på showsiden med «How did it go?». Ett trykk per komiker: sterkt,
middels, svakt, eller avlyste. Vurderingen lagres i
`artist_performance_reviews` med klubben som ga den, og `admin_score` regnes
på nytt som snittet av de siste ti — `lib/artist-reviews.ts`. Kan endres i 30
dager.

## 10. «Trenger oppmerksomhet»

Øverst på `/admin-app/shows` ligger alt automatikken ikke klarer alene:
plasser uten kandidater, kandidater som er brukt opp, fristen som nærmer seg
eller er passert, show som ikke kan publiseres, bookerens egne tilbud som
holder plassen, mange nei på samme plass, søknader og lineups som ikke er
vurdert. Logikken er en ren funksjon i `lib/booking-attention.ts`;
radene hentes i `lib/booking-attention-data.ts` med de samme reglene som
motoren, så listen ikke kan si noe annet enn det motoren gjør.

## Verdt å vite

- **Motoren trekker ubesvarte tilbud uten e-post.** Tilbud den sendte selv
  trekkes når komikeren ikke lenger matcher plassen, for eksempel etter at
  bookeren har endret kravene. Alle tilbud, også manuelle, trekkes når
  komikeren er ekskludert, flagget eller fjernet fra klubbens liste.
- **Innstillingene er globale** og redigeres på `/superadmin/booking`.
  Lineup-fristen kan overstyres per klubb på Min klubb.
  Grensene håndheves i `lib/booking-settings.ts`, både når verdiene lagres og
  når de leses.
- **Et manuelt tilbud i et utkast starter ikke automatikken.** Showet går til
  `booking`, men `auto_started_at` settes bare av Start booking.
