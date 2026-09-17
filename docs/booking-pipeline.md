# Booking: fra «Start booking» til publisert lineup

Slik fylles en lineup i dag, lest ut av koden. Motoren ligger i `lib/actions/booking.ts`. Handlingene bak knappene i admin ligger i `app/admin-app/(protected)/shows/actions.ts`.

## Flyten i korte trekk

1. Bookeren oppretter et show (`draft`) med en standard-lineup.
2. **Start booking** setter showet til `booking` og starter motoren.
3. Motoren sender tilbud på e-post til komikere fra klubbens egen liste.
4. Den første komikeren som sier ja, får plassen.
5. Hvert svar kjører motoren på nytt, og ledige plasser får nye tilbud.
6. Når alle plasser er fylt, publiseres showet. Bookeren kan også publisere før det.

## 1. Plassene og parameterne

Et nytt show får seks plasser: Headliner (15 %), Host (15 %), tre Stand-up (10 % hver) og Open Mic (0 %). Hver plass er en rad i `show_requirements`:

| Parameter | Betydning |
|---|---|
| `role_name` | Headliner, Host, Stand-up eller Open Mic. Et hardt krav, og styrer prioriteringen mellom plassene. |
| `quantity` | Antall seter. Standard er 1. |
| `lineup_position` | Rekkefølgen i lineupen. |
| `min_score` | Laveste score. Aldri under 6. |
| `energy_level` | `any`, `high`, `low` eller `uncertain`. Må stemme eksakt med klubbens vurdering av komikeren. |
| `required_gender` | `any`, `woman`, `man` eller `non_binary`. Sjekkes mot komikerens egen profil. |
| `compensation_*` | Fast beløp eller prosent av billettsalget. |
| `submissions_open` | Plassen tar imot søknader, og motoren lar den være. |

**Start booking** krever at hver plass har rolle og honorarmodell, og at prosentene til sammen ikke overstiger klubbens artistandel (`artist_share_bps`).

## 2. Hvem som kan få tilbud

Motoren henter kandidater bare fra klubbens egen liste (`club_artists`). En komiker kan få tilbud på en plass når hen:

- er `approved` på plattformen og ikke flagget av klubben
- har plassens rolle blant rollene *klubben* har satt på hen
- matcher energi og kjønn, med mindre plassen står på `any`
- har `admin_score` på minst `max(min_score, 6)`
- ikke står i lineupen, og ikke har et sendt, godtatt, avslått eller utløpt tilbud på showet (trukne tilbud og tilbud som ble tatt av en annen, teller ikke)
- ikke er ekskludert fra showet. Det skjer når bookeren trekker tilbudet eller fjerner komikeren, og oppheves når bookeren velger hen manuelt igjen.

En komiker har aldri mer enn ett aktivt tilbud per show.

## 3. Rangeringen av komikere

Kandidatene sorteres på poeng. Vektene står i raden `default` i tabellen `booking_scoring_config`. De kan endres uten deploy, men det finnes ikke noe grensesnitt for det.

```
poeng = admin_score / 10 × 100     kvalitet
      + 30                         har meldt seg ledig på showdatoen
      + 15                         rollematch (alltid oppfylt, rollen er et krav)
      − 15 × antall bookinger      siste 30 dager og alle kommende
```

Nye komikere får score 7, og scoren settes ikke lenger for hånd. For alle som står på 7, avgjøres rekkefølgen derfor av to ting: om komikeren har markert datoen som ledig (maks tre kommende datoer i portalen), og hvor mange bookinger hen har fra før, på tvers av alle klubber. Ved likt poeng finnes det ingen tie-breaker; rekkefølgen fra databasen avgjør.

## 4. Prioriteringen mellom plassene

Plassene konkurrerer om de samme komikerne. Tilbudene fordeles derfor i to steg:

1. **Dekning.** Først får hvert ledige sete minst ett tilbud. Rekkefølgen er Host → Headliner → Stand-up → Open Mic, deretter flest seter uten tilbud, lavest `lineup_position` og færrest kandidater.
2. **Bredde.** Så fylles det på i runder. Hver plass får én bølge per runde, like stor som antall ledige seter, til den har 10 ubesvarte tilbud per ledig sete (`offers_per_slot`). Seter der bookeren har sendt et tilbud selv, regnes ikke med (se punkt 6). Rollerekkefølgen er den samme, men innenfor en rolle går plasser med få kandidater først og plasser uten kandidater sist.

Rundene hindrer at den første av tre Stand-up-plasser tømmer listen før de to andre får noen. Med standard-lineupen kan opptil 60 tilbud gå ut samtidig.

**Fallback.** Er det tomt for kandidater, senkes minstescoren med 1, og så med 2. Rolle, energi og kjønn senkes aldri. Da sorteres det bare på score, med maks 5 tilbud per plass per kjøring (`fallback_limit`).

## 5. Tilbudet og svaret

Hvert tilbud blir en rad i `booking_offers` med en lenke (`/booking-offer/[token]`) som kan besvares uten innlogging. Tilbudet gjelder i 7 dager, men aldri lenger enn ut showdagen. Fast honorar kopieres inn på tilbudet; prosentavtaler leses fra plassen.

- **Ja:** Databasefunksjonen `accept_booking_offer` låser tilbudet og lager en `confirmed_spot`, og komikeren får bekreftelse på e-post. Er plassen allerede fylt, får komikeren beskjed om det. Blir plassen full, settes de andre ubesvarte tilbudene på den til `filled_by_other`, uten e-post. De komikerne kan fortsatt få tilbud på en annen plass på showet.
- **Nei:** Svaret kvitteres på e-post, og motoren tilbyr ikke komikeren showet igjen.

Etter hvert svar kjører motoren på nytt og fyller opp kvoten.

## 6. Bookerens manuelle grep

- **Send tilbud:** Bookeren velger komikeren selv, også en som ikke matcher plassen. Komikeren må være på klubbens liste og må fortsatt si ja. Tilbudet merkes som manuelt (`source: 'manual'`): motoren trekker det ikke fordi komikeren ikke matcher, og sender ikke setet til andre mens det venter på svar. Det samme gjelder godkjente søknader og tilbud bookeren flytter til en annen plass.
- **Legg til direkte:** Komikeren settes rett inn i lineupen, uten tilbud.
- **Fjern fra lineupen:** Komikeren tas ut og ekskluderes. Ubesvarte tilbud på plassen trekkes, og en ny runde går ut med «Ledig spot»-e-post.
- **Trekk tilbud:** Komikeren ekskluderes fra showet, og motoren kjører på nytt.
- **Åpne energinivå:** Plassen settes til `any`, og motoren kjører på nytt.

## 7. Søknader

En plass med `submissions_open` fylles av komikere som søker, ikke av motoren. Per show velger bookeren hvem som kan søke (`roster` eller `everyone`), og en eventuell frist. Komikerne ser plassene under «Open spots» mens showet er i `booking`. Godtar bookeren en søknad, går det ut et vanlig tilbud. En søker som ikke er på klubbens liste, blir lagt til der først, med rollen hen søkte på.

## 8. Publisering

`automateFullbookedShow` setter showet til `published`, og da åpner billettsalget. Det skjer på tre måter:

- **Automatisk** når alle seter er fylt. Sjekken kjøres hver gang motoren kjører, og når bookeren legger inn komikere direkte eller sletter plasser. Fylles siste plass av et ja, går showet først innom `fullbooked`, og markedsføringsoppgavene opprettes.
- **Manuelt** med **Publish lineup**, så snart minst én komiker er bekreftet. Ubesvarte tilbud løper videre, og de som sier ja senere, kommer med i lineupen.
- **Daglig kl. 09:00 UTC** via GitHub Actions (`run-automation.yml`, som kaller `/api/cron/publish-fullbooked`). Jobben merker utløpte tilbud og publiserer fylte show som har blitt liggende.

Publisering krever at klubbens Stripe Connect-oppsett er ferdig. Ellers blir showet liggende upublisert til jobben prøver igjen. Plakat lages bare automatisk når `auto_poster_enabled` er slått på.

## Verdt å vite

- **Etter publisering sender motoren ingen nye tilbud**, heller ikke når en plass blir ledig. Den kjører bare for show i `booking`.
- **Utløpte tilbud erstattes ikke av seg selv.** Nye tilbud går først ut neste gang noe annet får motoren til å kjøre.
- **Motoren trekker ubesvarte tilbud uten e-post.** Tilbud den sendte selv trekkes når komikeren ikke lenger matcher plassen, for eksempel etter at bookeren har endret kravene. Alle tilbud, også manuelle, trekkes når komikeren er ekskludert, flagget eller fjernet fra klubbens liste. Reglene står i `lib/booking-rules.ts`.
