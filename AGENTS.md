<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Grunnfargen på de offentlige flatene

`--ev-bg` i `app/globals.css` er **#fdf4ed**, og den skal bli stående.

Alle offentlige sider og portaler (`app/page.tsx`, `/events`, `/artist-app`,
`/admin-app/login`, checkout, legal) setter `bg-[var(--ev-bg)]` og henter
altså fargen derfra. Kort, felter og linjer er gjennomsiktige lag oppå den.

- Ikke skriv en bakgrunnsfarge rett inn på en side (`bg-[#...]`).
- Ikke overstyr `--ev-bg` lokalt med `style` for å treffe en skisse eller et
  skjermbilde — fargen i skissen er en gjengivelse, ikke en ny token.
- Skal grunnfargen faktisk endres, endres den ett sted: `--ev-bg` i
  `app/globals.css`. Den mørke varianten er `.ev-surface[data-tone='dark']`.
