# Slik booker Tickethalo en lineup

Dette er bookingalgoritmen slik den skal fungere etter omleggingen. Den er skrevet for alle som skal se på den, enten du jobber med data eller ikke. Fremdriften i arbeidet står i [booking-plan.md](booking-plan.md), og dagens løsning i [booking-pipeline.md](booking-pipeline.md).

Kort fortalt: klubben beskriver kvelden den vil ha, og systemet finner komikerne. Klubben skal slippe å ringe rundt, og lineupen skal bli slik den ble bestilt.

## 1. Bestillingen

En klubb lager et show og setter opp lineupen som en liste med plasser. En vanlig kveld ser slik ut:

| Plass | Rolle | Honorar |
|---|---|---|
| 1 | Headliner | 15 % av billettsalget |
| 2 | Host | 15 % |
| 3–5 | Stand-up | 10 % hver |
| 6 | Open Mic | Ingen |

For hver plass kan klubben si mer om hvem den vil ha:

- **Rolle:** Headliner, Host, Stand-up eller Open Mic.
- **Energi:** høy, lav, eller «spiller ingen rolle».
- **Kjønn:** kvinne, mann, ikke-binær, eller «spiller ingen rolle».
- **Honorar:** en fast sum, eller en prosent av billettsalget.

Dette er bestillingen. Systemet endrer den aldri på egen hånd. Finner det ingen som passer, sier det fra til bookeren i stedet for å sende tilbud til noen som ikke passer.

Når bookeren trykker **Start booking**, tar systemet over.

## 2. Hvem kan få et tilbud

Før noen får et tilbud, må alt dette stemme. Dette er krav, ikke ønsker:

1. **Komikeren er på klubbens liste.** Hver klubb har sin egen liste over komikere den jobber med. Systemet henter aldri noen utenfra.
2. **Klubben har ikke flagget komikeren.** Et flagg skjuler komikeren fra klubbens booking, og bare fra den.
3. **Komikeren er godkjent på plattformen.**
4. **Rollen stemmer.** Klubben bestemmer selv hvilke roller den booker hver komiker i. Den samme komikeren kan være headliner hos én klubb og klubbspot hos en annen.
5. **Energi og kjønn stemmer,** når plassen krever det.
6. **Komikeren er ledig den dagen.** Komikere markerer i en kalender hvilke dager de ikke kan. De dagene får de aldri tilbud.
7. **Ingen kollisjon.** Har komikeren allerede takket ja til et show som starter mindre enn tre timer unna, er hen ute. Tre timer gjør at to spots på én kveld fortsatt går, men samme scenetid to steder er umulig.
8. **Komikeren er ikke involvert i showet fra før.** Har hen sagt nei, latt et tilbud gå ut, har et tilbud ute, står i lineupen, eller er tatt av showet av bookeren, sender systemet ikke et nytt tilbud.

Legg merke til hva som *ikke* står på listen: hvor god komikeren er. Kvalitet avgjør ikke hvem som kan få et tilbud. Den avgjør rekkefølgen.

## 3. Rekkefølgen: poeng

Alle som oppfyller kravene, stiller seg i kø. Køen sorteres på poeng:

```
poeng = score × 10 − 10 for hvert show komikeren
                       allerede har i klubben innen 30 dager
```

**Scoren** er et tall mellom 0 og 10 som sier hvordan komikeren har levert *hos denne klubben*. Hver klubb har sin egen score for hver komiker, og alle starter på 5. Etter hvert show vurderer klubben hver komiker med ett trykk: **svakt**, **middels** eller **sterkt**. Scoren er snittet av de ti siste vurderingene, der svakt teller 0, middels 5 og sterkt 10. Har komikeren færre enn tre vurderinger, fylles resten opp med 5, slik at én enkelt kveld ikke avgjør alt.

| Vurderinger | Score |
|---|---|
| Ingen ennå | 5,0 |
| Én sterk | 6,7 |
| To sterke | 8,3 |
| Tre sterke, så en middels | 8,8 |
| To svake | 1,7 |

Det finnes et fjerde valg: **avlyste eller møtte ikke opp**. Det teller som to svake kvelder. For en klubb er det verre at noen ikke dukker opp enn at kvelden var middels.

Fordi scoren er et snitt, kan ingen bygge seg fast på toppen, og en dårlig kveld kan hentes inn igjen. Den som leverer sterkt gang på gang, ligger øverst.

**Trekket for show i samme klubb** sprer bookingene. Har komikeren allerede en plass hos klubben innen 30 dager fra showdatoen, går det 10 poeng, altså ett scorepoeng, for hver slik plass. Publikum skal ikke se de samme fem ansiktene hver gang. Show i *andre* klubber teller ikke. Ingen skal straffes for å jobbe.

Står to komikere helt likt, går den som har ventet lengst siden forrige kveld i klubben først. Har en av dem aldri spilt der, går hen først.

## 4. Tilbudene går ut i bølger

Systemet kunne sendt tilbud til alle med en gang. Da hadde plassen gått til den som svarte først, ikke til den beste. Derfor går tilbudene ut litt om gangen:

- **Dag 1:** de to beste for hver ledige plass får tilbud.
- **Dag 2:** to til, hvis plassen fortsatt er åpen.
- **Og så videre,** til det er ti tilbud ute på plassen. Der stopper det.

Sier noen nei, går tilbudet videre til neste i køen med en gang. Da står ikke plassen og venter til neste dag.

To ting styrer hvem som får tilbud på hvilken plass:

- **En komiker har bare ett aktivt tilbud per show.** Hele lineupen deler den samme listen med komikere.
- **Plassen med færrest kandidater velger først.** Er det bare to i klubben som kan være Host, skal ikke Headliner-plassen ta dem først.

Nye tilbud går ut hver morgen, så de lander til frokost og ikke midt på natten.

**Den første som sier ja, får plassen.** De andre tilbudene på den plassen faller bort, og de komikerne får beskjed om at plassen gikk til en annen. De er umiddelbart tilbake i køen til de andre plassene på showet.

## 5. Frister

- **Et tilbud varer i sju dager.** Svarer ingen, faller det bort, og plassen kan tilbys videre. Komikeren får en påminnelse på e-post når det er under to døgn igjen.
- **Klubben har en lineup-frist,** som standard 14 dager før showet. Da skal lineupen være klar, slik at plakat og markedsføring rekker å bli ferdig.
- **Nærmer fristen seg,** fra fem dager før, går alle ti tilbudene ut med en gang. Da er det viktigere å fylle plassen enn å vente på de beste.
- **Etter fristen** kortes svartiden ned til to døgn, og ingen tilbud går ut senere enn dagen før showet.
- **På selve showdagen** sender ikke systemet tilbud. Da er det bookeren som må ringe.

## 6. Når noen svarer

Komikeren får en e-post med dato, sted, rolle og honorar, og svarer med én lenke. Ingen innlogging.

- **Ja:** plassen er bekreftet med en gang. Ingen andre kan ta den. Har komikeren i mellomtiden takket ja til et show som kolliderer, får hen beskjed om det i stedet, og plassen er fortsatt åpen for andre.
- **Nei:** komikeren får en kvittering, og systemet spør ikke igjen om det showet. Neste i køen får tilbudet.
- **Ikke svart:** tilbudet faller bort etter fristen, og plassen går videre.

Når en komiker takker ja til en kveld, trekkes tilbudene hen har på andre show som kolliderer med den. Ingen kan bli booket to steder samtidig.

## 7. Når bookeren tar over

Bookeren kan alltid gå foran systemet:

- **Sende et tilbud selv** til hvem som helst på klubbens liste, også en som ikke oppfyller kravene til plassen. Bookeren kjenner komikerne sine.
- **Legge en komiker rett inn i lineupen** uten tilbud, for eksempel når avtalen er gjort på telefon.
- **Åpne en plass for søknader.** Da melder komikerne seg selv, og bookeren velger. Systemet holder seg unna de plassene.
- **Bytte, flytte eller fjerne** en komiker.

Sender bookeren et tilbud selv, holder det plassen: systemet sender ikke tilbud til andre på det setet mens svaret venter, og trekker ikke tilbudet fordi komikeren ikke passer kravene. Valget til bookeren vinner. Sier komikeren nei, tar systemet plassen tilbake.

## 8. Når systemet står fast

Noen ganger går det ikke. Klubben har ingen kvinnelig headliner med høy energi, eller alle som passer har sagt nei. Systemet gjetter ikke, og det senker ikke kravene i det stille. Det sier fra.

Øverst på showoversikten ligger en liste: **Trenger oppmerksomhet**. Der står alt bookeren må ta stilling til:

**Kritisk:**
- Ingen på listen oppfyller kravene til plassen. Listen viser hvilket krav som stenger, og hvor mange som ville passet om det ble lempet.
- Alle som passer har fått tilbud, og ingen svar venter.
- Lineup-fristen er passert, og plasser står tomme.
- Lineupen er full, men showet kan ikke publiseres fordi klubbens utbetalingsoppsett mangler.
- Et publisert show har fått en ledig plass.

**Advarsel:**
- Lineup-fristen er nær, med plasser igjen.
- Et utkast er ikke startet, og fristen nærmer seg.
- Bookerens eget tilbud har ventet i over tre døgn og holder plassen.
- Tre eller flere har sagt nei til den samme plassen. Da er det gjerne honoraret eller kravene som er feil.

**Oppfølging:**
- Søknader venter på svar.
- Et show er spilt, men lineupen er ikke vurdert.

Bookeren kan da åpne energinivået, fjerne kjønnskravet, hente flere komikere inn på listen, sende et tilbud selv, åpne plassen for søknader — eller slette plassen og kjøre showet med en komiker mindre.

## 9. Publisering

Et show publiseres først når hele lineupen er bekreftet. Da skjer alt på én gang: eventsiden går live, billettsalget åpner, og markedsføringsoppgavene opprettes.

Grunnen er enkel: publikum kjøper billett til en kveld med navn på. En halvfylt plakat selger dårligere, og navn som dukker opp etterpå, er vanskelige å markedsføre.

Det betyr også at klubben bestemmer størrelsen. Vil de kjøre med fem komikere i stedet for seks, sletter bookeren plassen. Da er lineupen full.

Faller en komiker fra etter publisering, blir showet stående publisert — billettene er solgt — og systemet begynner å fylle plassen igjen med en gang. Bookeren får varsel, og må oppdatere plakaten.

## 10. Etter showet

Dagen etter showet gjør systemet opp honorarene, og showet merkes som ferdig. Da dukker lineupen opp igjen hos bookeren med spørsmålet: hvordan gikk det? Ett trykk per komiker: svakt, middels, sterkt — eller avlyste.

Dette er sløyfen som gjør systemet bedre over tid. Vurderingen endrer scoren, scoren endrer køen, og køen avgjør hvem som får tilbud på neste show. En klubb som vurderer hver kveld, får en liste som gradvis sorterer seg selv.

Scoren er klubbens egen. Klubbene har ikke samme publikum. Geografi og demografi gjør at en komiker som treffer hos én klubb, ikke nødvendigvis treffer hos en annen. Derfor teller en vurdering bare hos klubben som ga den. En svak kveld ett sted flytter ikke komikeren ned i køen et annet sted, og en klubb som aldri har vurdert komikeren, starter på nøytrale 5,0.

## 11. En kveld fra start til slutt

Klubben legger inn en fredag med seks plasser, og trykker Start booking 30 dager før showet. Lineup-fristen er 14 dager før, altså om 16 dager.

- **Dag 1.** Systemet finner kandidater til hver plass. Headliner-plassen har åtte, Host-plassen bare tre. Host velger først. De to beste på hver plass får e-post — 12 tilbud i alt.
- **Dag 1, om kvelden.** Host-tilbudet til nummer to blir avslått. Nummer tre får det med en gang.
- **Dag 2.** Én headliner takker ja. Plassen er bekreftet, og det andre tilbudet på den plassen faller bort. Den komikeren er tilbake i køen til stand-up-plassene. To nye tilbud går ut på hver plass som fortsatt er åpen.
- **Dag 5.** Fire av seks plasser er fylt. Én stand-up-plass har ti tilbud ute og venter. Open Mic-plassen har ingen kandidater igjen, og dukker opp som kritisk i Trenger oppmerksomhet.
- **Dag 6.** Bookeren åpner Open Mic-plassen for søknader. Tre komikere melder seg i løpet av kvelden, og bookeren godtar én. Tilbudet går ut, og hen takker ja dagen etter.
- **Dag 9.** Siste stand-up-plass er fylt. Lineupen er komplett, showet publiseres, og billettsalget åpner — fem dager før fristen.
- **Dag 26.** Showet spilles.
- **Dag 27.** Honorarene gjøres opp. Bookeren vurderer lineupen: fire sterke, én middels, én svak. Scorene oppdateres, og neste fredag starter køen litt annerledes.

## 12. Det systemet aldri gjør

- Sender aldri tilbud til noen som ikke oppfyller klubbens krav til plassen, med mindre bookeren selv velger det.
- Senker aldri kravene på egen hånd.
- Booker aldri den samme komikeren to steder samme kveld.
- Sender aldri tilbud på en dag komikeren har markert som opptatt.
- Publiserer aldri et show med ledige plasser.
- Trekker aldri et tilbud bookeren har sendt selv, uten at komikeren er tatt av showet, flagget eller fjernet fra klubbens liste.

## 13. Det som kan justeres

Alt dette er innstillinger, ikke kode. De kan endres uten en ny versjon av systemet:

| Innstilling | Standard |
|---|---|
| Nye tilbud per plass per dag | 2 |
| Maks tilbud ute på én plass | 10 |
| Svarfrist | 7 dager |
| Påminnelse før fristen | 48 timer |
| Lineup-frist før showet | 14 dager (per klubb) |
| Full utsendelse fra | 5 dager før lineup-fristen |
| Trekk per show i samme klubb | 10 poeng |
| Periode for det trekket | 30 dager |
| Kollisjon mellom to show | under 3 timer |

Standardene er utgangspunktet. Ser vi at plasser står tomme, kan tilbudene komme raskere. Ser vi at kvaliteten vakler, kan de komme saktere.
