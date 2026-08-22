# MVP QA Runbook

Denne sjekklisten dekker de tre flatene i samme Next.js-app:

- `http://admin.localhost:3000`
- `http://artist.localhost:3000`
- `http://localhost:3000`

## Lokal routing

Start appen:

```bash
pnpm dev
```

Smoke-test host-routing:

```bash
curl -I http://localhost:3000/
curl -I http://localhost:3000/events
curl -I http://artist.localhost:3000/
curl -I http://admin.localhost:3000/
```

Forventning:

- `localhost:3000` viser public events.
- `artist.localhost:3000` rewrites internt til `/artist-app`.
- `admin.localhost:3000` rewrites internt til `/admin-app` og sender ikke-innloggede brukere til `/login` på admin-subdomain.
- `/api/*` rewrites ikke til admin/artist, slik at webhooks og API-ruter er globale.

## Kritisk ende-til-ende-flow

1. Artist registrerer seg fra `localhost:3000/artist-app/signup`.
2. Admin logger inn fra `admin.localhost:3000/login`.
3. Admin åpner ny artist, ser AI-vurdering, setter score og godkjenner.
4. Artist logger inn og velger opptil tre datoer.
5. Admin oppretter show og legger inn requirements. Bookingtilbud sendes automatisk når krav lagres.
6. Artist mottar bookingtilbud og aksepterer.
7. Når alle krav er fylt, genereres plakat, eventet publiseres, billettsalg aktiveres og marketing checklist opprettes automatisk.
8. Publikum åpner `localhost:3000/events/:slug`, starter checkout og betaler.
9. Stripe webhook oppretter order og ticket, sender billettmail og sender Purchase til Stape.
10. Admin verifiserer ordre, tracking, e-postlogg og artistøkonomi.

## Race condition

Booking-accept går gjennom Postgres-funksjonen `accept_booking_offer(p_token)`, som låser requirement-raden før den teller og oppretter spot.

Scenario:

- Ett show trenger `quantity = 1` support.
- Fem booking offers har status `sent` på samme requirement.
- Kjør to aksepter parallelt med ulike tokens.

Forventning:

- Nøyaktig én rad opprettes i `confirmed_spots`.
- Vinnerens offer får `accepted`.
- Resterende åpne offers på samme requirement får `filled_by_other`.
- Show markeres `fullbooked` når alle requirements er fylt.
- Marketing tasks opprettes én gang per task.

## Stripe checkout og webhook

Checkout validerer før redirect:

- `shows.status = published`
- `shows.date >= today`
- kapasitet ikke utsolgt basert på `valid` og `used` tickets

Webhook `checkout.session.completed` går gjennom Postgres-funksjonen `complete_checkout_order(...)`.

Forventning:

- Samme `stripe_checkout_session_id` behandles idempotent.
- Duplicate webhook retry lager ikke ekstra order, ticket, e-post eller Stape Purchase.
- Ved utsolgt etter checkout opprettes en `cancelled` order uten ticket, slik at admin kan følge opp/refundere.
- Payment failed markerer matchende order som `failed` når payment intent finnes.
- Refund markerer order og tickets som `refunded`.

## Resend

Test disse e-posttypene og sjekk `email_logs`:

- Artist registered
- Artist approved
- Booking offer
- Booking confirmed
- Spot filled
- Ticket purchase

Forventning: e-postfeil logges som `failed`, men stopper ikke hovedflyten.

## AI

Test artister med mye data, lite data, vanlig navn, ingen sosiale lenker og kun Instagram.

Forventning:

- Lite data gir lav confidence, ikke automatisk lav score.
- Kilder og uncertainties vises for admin.
- API-feil lagres kontrollert som failed/pending uten å blokkere admin-overstyring.

## Stape

Test:

- InitiateCheckout på kjøpsklikk.
- Purchase etter webhook.
- Manglende cookies, IP eller user agent.
- Stape API-feil.

Forventning: trackingfeil logges i `tracking_events`, men blokkerer aldri checkout, webhook, ordre eller billettmail.

## Deploy

Før deploy:

```bash
pnpm lint
pnpm build
```

Supabase:

- Kjør alle migrasjoner, inkludert `004_mvp_hardening.sql`.
- Verifiser at RLS er aktivert.
- Verifiser at service-role kun finnes i server-side environment.

Vercel/domener:

- Admin-domain peker til samme app og bruker host-routing.
- Artist-domain peker til samme app og bruker host-routing.
- Public-domain peker til samme app uten rewrite.
- Stripe webhook peker til `/api/webhooks/stripe`.

Påkrevd env:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `OPENAI_API_KEY`
- `STAPE_CAPI_ENDPOINT`
- `STAPE_CAPI_TOKEN`
- `ARTIST_APP_URL`
- `FACEBOOK_PAGE_ID` og `FACEBOOK_PAGE_ACCESS_TOKEN` for automatisk Facebook-posting etter fullbooked