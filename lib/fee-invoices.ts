import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { appPath } from '@/lib/app-url'
import type { ArtistFeeInvoice, ArtistFeeInvoiceStatus } from '@/types/database'

/**
 * Fakturaen komikeren sender etter showet — og kontrollen av den.
 *
 * Honoraret regnes ut i `lib/artist-fees.ts`. Her ligger den andre siden av
 * det: hvem fakturaen skal til, referansen den må ha, og hva som må stemme
 * før klubben betaler den.
 *
 * Klubben er selger, sitter på billettinntekten og betaler komikeren.
 * Tickethalo står likevel for grunnlaget, fordi det er vi som vet hva
 * honoraret er: avtalen ligger i lineupen, salget i ordrene, kontoen i
 * komikerens profil. Klubben skal slippe å regne det ut på nytt for å tro på
 * en faktura.
 *
 * Kravet er bevisst strengt: klubben betaler bare fakturaer systemet har bedt
 * om. Hver honorar-epost oppretter én rad med en referanse ingen kan gjette,
 * og beløpet det ble bedt om. En faktura uten den referansen, på et annet
 * beløp, eller på en referanse som allerede er gjort opp, er ikke et krav —
 * den er et avvik, og kontrollen sier hvilket.
 */

// ─────────────────────────────────────────────────────────────
// Hvem fakturaen går til
// ─────────────────────────────────────────────────────────────

/** Lenken komikeren får i eposten. Se `app/fee/[token]`. */
export function feeInvoiceUrl(token: string) {
  return appPath(`/fee/${token}`)
}

/** Klubbfeltene en fakturamottaker settes sammen av. */
export type InvoiceRecipientClub = {
  name: string
  legal_name?: string | null
  org_number?: string | null
  invoice_email?: string | null
  support_email?: string | null
}

export type InvoiceRecipient = {
  /** Navnet fakturaen stiles til. */
  name: string
  orgNumber: string | null
  /** Adressen den sendes til. Null når klubben ikke har oppgitt noen. */
  email: string | null
}

/**
 * Fakturamottakeren for en klubb.
 *
 * Juridisk navn foran visningsnavnet: det er den juridiske enheten som er
 * debitor, og «Crønch Comedy (TEST)» er ikke et foretak. `invoice_email` foran
 * `support_email` fordi den ene er regnskap og den andre er publikum — men
 * en klubb som bare har fylt ut den ene skal ikke etterlate komikeren uten
 * adresse.
 */
export function clubInvoiceRecipient(club: InvoiceRecipientClub): InvoiceRecipient {
  return {
    name: club.legal_name?.trim() || club.name.trim(),
    orgNumber: club.org_number?.trim() || null,
    email: club.invoice_email?.trim() || club.support_email?.trim() || null,
  }
}

// ─────────────────────────────────────────────────────────────
// Referansen
// ─────────────────────────────────────────────────────────────

/** Samme alfabet som billettkodene: ingen I, L, O eller U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const SUFFIX_LENGTH = 6

function randomSuffix() {
  // 256 er delelig med 32, så modulo gir jevn fordeling uten skjevhet.
  const bytes = randomBytes(SUFFIX_LENGTH)
  let result = ''
  for (const byte of bytes) result += ALPHABET[byte % ALPHABET.length]
  return result
}

/** «TH-2608-K7QP3M» — år og måned foran, så en referanse kan plasseres i tid. */
export function buildFeeInvoiceReference(issued = new Date()) {
  const yy = String(issued.getUTCFullYear()).slice(2)
  const mm = String(issued.getUTCMonth() + 1).padStart(2, '0')
  return `TH-${yy}${mm}-${randomSuffix()}`
}

/**
 * Referansen slik den er lagret, uansett hvordan den er skrevet av.
 *
 * Den reiser gjennom en faktura, en innboks og et tastatur før den slås opp
 * igjen. Bindestrekene og små bokstaver er lesehjelp, ikke innhold — og den
 * kommer like gjerne limt inn med en halv fakturalinje rundt seg
 * («Deres ref: TH-2608-K7QP3M»). Et oppslag som ikke tåler det, sier
 * «finnes ikke» om en gyldig referanse, og det er nettopp det svaret som
 * ikke må være feil her.
 *
 * Grensene på hver side er strenge: en referanse er bare en referanse når
 * den står for seg selv. `TH-2608-K7QP3MX` er ikke en gyldig referanse med
 * en X etter, det er noe annet, og skal ikke slå opp som vår.
 */
export function normalizeFeeInvoiceReference(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').toUpperCase()
  const pattern = new RegExp(
    `(?<![0-9A-Z])TH[\\s-]?(\\d{4})[\\s-]?([${ALPHABET}]{${SUFFIX_LENGTH}})(?![0-9A-Z])`,
  )
  const match = text.match(pattern)
  if (!match) return null
  return `TH-${match[1]}-${match[2]}`
}

// ─────────────────────────────────────────────────────────────
// Utstedelse
// ─────────────────────────────────────────────────────────────

export type IssueFeeInvoiceInput = {
  spotId: string
  showId: string
  artistId: string
  clubId: string | null
  amount: number
  currency: string
  agreement: string | null
  bankAccountNumber: string | null
  artistEmail: string | null
}

/**
 * Grunnlaget for én spot.
 *
 * Idempotent på spot: finnes raden fra før, er referansen allerede sendt til
 * komikeren og skal stå. Beløpet holdes i takt av `syncFeeInvoiceAmount`, som
 * bare rører grunnlag ingen har begynt å behandle.
 */
export async function issueFeeInvoice(input: IssueFeeInvoiceInput): Promise<ArtistFeeInvoice | null> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('artist_fee_invoices')
    .select('*')
    .eq('spot_id', input.spotId)
    .maybeSingle()

  if (existing) {
    return (await syncFeeInvoiceAmount({
      spotId: input.spotId,
      amount: input.amount,
      currency: input.currency,
      agreement: input.agreement,
    })) ?? (existing as ArtistFeeInvoice)
  }

  // Kollisjon på referansen er usannsynlig (32^6 ≈ 1,07 milliarder), men
  // unique-indeksen er den som avgjør. Noen forsøk, så gir vi opp heller enn
  // å sende ut et grunnlag uten referanse.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await db
      .from('artist_fee_invoices')
      .insert({
        reference: buildFeeInvoiceReference(),
        spot_id: input.spotId,
        show_id: input.showId,
        artist_id: input.artistId,
        club_id: input.clubId,
        amount: input.amount,
        currency: input.currency,
        agreement: input.agreement,
        bank_account_number: input.bankAccountNumber,
        artist_email: input.artistEmail,
      })
      .select('*')
      .single()

    if (!error && data) return data as ArtistFeeInvoice
    // 23505 = unique_violation. På spot_id betyr det at en parallell kjøring
    // rakk det først; da er det den raden som gjelder.
    if (error?.code !== '23505') {
      console.error(`[FeeInvoice] ${input.spotId}: ${error?.message}`)
      return null
    }

    const { data: raced } = await db
      .from('artist_fee_invoices')
      .select('*')
      .eq('spot_id', input.spotId)
      .maybeSingle()

    if (raced) return raced as ArtistFeeInvoice
  }

  console.error(`[FeeInvoice] ${input.spotId}: fant ingen ledig referanse`)
  return null
}

/**
 * Holder beløpet i takt med utregningen.
 *
 * Kjøringen går daglig og kan treffe et show før siste ordre er landet; da
 * skal grunnlaget følge etter. Men bare så lenge det er urørt: har noen først
 * mottatt, klarert eller betalt en faktura på referansen, er beløpet det som
 * ble avtalt der. Endrer utregningen seg etter det, er det en sak for et
 * menneske — ikke noe en nattlig kjøring skal skrive om i det stille.
 */
export async function syncFeeInvoiceAmount(opts: {
  spotId: string
  amount: number
  currency: string
  agreement: string | null
}): Promise<ArtistFeeInvoice | null> {
  const db = createAdminClient()

  // Null kroner er ikke et grunnlag å be om penger for, og tabellen tillater
  // det ikke. Faller honoraret til null etter at grunnlaget gikk ut — alt er
  // refundert — står raden urørt og saken hører hjemme hos et menneske.
  if (opts.amount > 0) {
    const { data } = await db
      .from('artist_fee_invoices')
      .update({
        amount: opts.amount,
        currency: opts.currency,
        agreement: opts.agreement,
        updated_at: new Date().toISOString(),
      })
      .eq('spot_id', opts.spotId)
      .eq('status', 'issued')
      .select('*')
      .maybeSingle()

    if (data) return data as ArtistFeeInvoice
  }

  const { data: current } = await db
    .from('artist_fee_invoices')
    .select('*')
    .eq('spot_id', opts.spotId)
    .maybeSingle()

  return (current as ArtistFeeInvoice) ?? null
}

// ─────────────────────────────────────────────────────────────
// Kontrollen
// ─────────────────────────────────────────────────────────────

export type CheckLevel = 'ok' | 'warn' | 'fail'

export type InvoiceCheck = {
  key: 'reference' | 'amount' | 'account' | 'duplicate'
  level: CheckLevel
  label: string
  detail: string
}

export type FeeInvoiceContext = ArtistFeeInvoice & {
  artist: { id: string; full_name: string; stage_name: string | null; email: string | null; bank_account_number: string | null } | null
  show: { id: string; title: string; date: string; venue_name: string | null } | null
  club: { id: string; name: string } | null
}

export type VerifyInvoiceInput = {
  /** Referansen slik den står på fakturaen. */
  reference: string
  /**
   * Klubben som spør. Et grunnlag som hører til en annen klubb svarer «ukjent
   * referanse», ikke «tilhører noen andre» — en klubb har ikke noe med å vite
   * hva en annen klubb skylder hvem.
   */
  clubId: string
  /** Beløpet på fakturaen, i hele kroner slik det leses av. Valgfritt. */
  invoicedAmountMajor?: number | null
  /** Kontonummeret på fakturaen, hvis det kontrolleres. */
  invoicedAccountNumber?: string | null
}

export type VerifyInvoiceResult = {
  reference: string | null
  invoice: FeeInvoiceContext | null
  checks: InvoiceCheck[]
  /**
   * Alt er kontrollert og alt stemmer. En kontroll som ikke er utført er ikke
   * en bestått kontroll — er beløpet ikke skrevet inn, er svaret nei.
   */
  payable: boolean
}

/** Kontonummer sammenlignes uten mellomrom og punktum — formen varierer. */
function sameAccount(a: string | null | undefined, b: string | null | undefined) {
  const clean = (value: string | null | undefined) => String(value ?? '').replace(/[\s.\-]/g, '').toUpperCase()
  const left = clean(a)
  const right = clean(b)
  return left.length > 0 && left === right
}

export function formatMinor(amount: number, currency: string) {
  // Samme regel som i e-postmalen: ører vises når de finnes. Kontrollen
  // sammenligner på øret, og da må tallet den viser gjøre det samme.
  const digits = amount % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 100)
}

/**
 * Slår opp en referanse og sier hva som stemmer.
 *
 * Svaret er en liste kontroller, ikke et ja eller nei alene: den som sitter
 * med fakturaen skal se *hva* som avviker. `fail` er de tingene som gjør
 * fakturaen ubetalbar slik den står — ukjent referanse, feil beløp, et krav
 * som allerede er gjort opp. `warn` er det som skal ses på av et menneske,
 * typisk at kontonummeret er endret etter at grunnlaget gikk ut.
 *
 * Oppslaget er alltid bundet til en klubb. Et grunnlag som hører til en annen
 * klubb finnes ikke herfra.
 */
export async function verifyFeeInvoice(input: VerifyInvoiceInput): Promise<VerifyInvoiceResult> {
  const reference = normalizeFeeInvoiceReference(input.reference)

  if (!reference) {
    return {
      reference: null,
      invoice: null,
      checks: [{
        key: 'reference',
        level: 'fail',
        label: 'Not one of our references',
        detail: 'Our references look like TH-2608-K7QP3M. Anything else did not come from a fee we asked to be invoiced.',
      }],
      payable: false,
    }
  }

  const found = await getFeeInvoiceByReference(reference)
  const invoice = found && found.club_id === input.clubId ? found : null

  if (!invoice) {
    return {
      reference,
      invoice: null,
      checks: [{
        key: 'reference',
        level: 'fail',
        label: 'Unknown reference',
        detail: `${reference} is not among your fees. Nobody was asked to invoice you for this — do not pay it.`,
      }],
      payable: false,
    }
  }

  const checks: InvoiceCheck[] = [{
    key: 'reference',
    level: 'ok',
    label: 'Reference is ours',
    detail: `${reference} was sent on ${new Date(invoice.issued_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to ${invoice.artist_email ?? 'the comedian'}.`,
  }]

  // Beløp. Uten et oppgitt beløp er ikke dette kontrollert — da sier vi det,
  // i stedet for å la en manglende kontroll se ut som en bestått.
  const expected = formatMinor(invoice.amount, invoice.currency)
  if (input.invoicedAmountMajor == null || Number.isNaN(input.invoicedAmountMajor)) {
    checks.push({
      key: 'amount',
      level: 'warn',
      label: 'Amount not checked',
      detail: `We asked for ${expected}. Type the amount from the invoice to compare.`,
    })
  } else {
    const invoiced = Math.round(input.invoicedAmountMajor * 100)
    checks.push(invoiced === invoice.amount
      ? { key: 'amount', level: 'ok', label: 'Amount matches', detail: `${expected}, as agreed${invoice.agreement ? ` (${invoice.agreement})` : ''}.` }
      : {
        key: 'amount',
        level: 'fail',
        label: 'Amount does not match',
        detail: `The invoice says ${formatMinor(invoiced, invoice.currency)}, we asked for ${expected} — a difference of ${formatMinor(invoiced - invoice.amount, invoice.currency)}.`,
      })
  }

  // Kontonummer. Det som sto da grunnlaget gikk ut er fasiten; er kontoen
  // endret i profilen etterpå, er det verdt et blikk selv om fakturaen
  // stemmer med den nye.
  const current = invoice.artist?.bank_account_number ?? null
  const snapshot = invoice.bank_account_number
  if (input.invoicedAccountNumber?.trim()) {
    const matchesSnapshot = sameAccount(input.invoicedAccountNumber, snapshot)
    const matchesCurrent = sameAccount(input.invoicedAccountNumber, current)

    checks.push(matchesSnapshot || matchesCurrent
      ? {
        key: 'account',
        level: matchesSnapshot ? 'ok' : 'warn',
        label: matchesSnapshot ? 'Account is the registered one' : 'Account changed after we asked',
        detail: matchesSnapshot
          ? `${snapshot} is on both the invoice and the profile.`
          : `The invoice uses the account now on the profile (${current}), but we sent the fee out with ${snapshot ?? 'no account'}. Confirm the change with the comedian before paying.`,
      }
      : {
        key: 'account',
        level: 'fail',
        label: 'Account is unknown',
        detail: `${input.invoicedAccountNumber.trim()} is neither on the profile (${current ?? 'none'}) nor on the fee we sent (${snapshot ?? 'none'}). Do not pay until the comedian confirms the account themselves.`,
      })
  } else {
    checks.push({
      key: 'account',
      level: 'warn',
      label: snapshot ? 'Account not checked' : 'No account on file',
      detail: snapshot
        ? `Registered account: ${snapshot}. Type the account from the invoice to compare.`
        : 'The comedian has no account number in the portal. You pay the account on the invoice either way — this check just has nothing to compare it against. Ask them to add it to their profile so the next one can be checked.',
    })
  }

  // Dublett. Den vanligste måten å betale for mye på er ikke en oppdiktet
  // faktura, men den samme fakturaen to ganger.
  if (invoice.status === 'paid') {
    checks.push({
      key: 'duplicate',
      level: 'fail',
      label: 'Already paid',
      detail: `Settled ${invoice.paid_at ? `on ${new Date(invoice.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'earlier'}. Another invoice on the same reference is a duplicate.`,
    })
  } else if (invoice.status === 'rejected') {
    checks.push({
      key: 'duplicate',
      level: 'fail',
      label: 'Rejected earlier',
      detail: invoice.note?.trim() || 'This fee was rejected. Reopen it before paying.',
    })
  }

  return {
    reference,
    invoice,
    checks,
    payable: checks.every((check) => check.level === 'ok'),
  }
}

/** Grunnlaget med komiker, show og klubb koblet på — det kontrollen leser. */
export async function getFeeInvoiceByReference(reference: string): Promise<FeeInvoiceContext | null> {
  const db = createAdminClient()

  const { data } = await db
    .from('artist_fee_invoices')
    .select('*')
    .eq('reference', reference)
    .maybeSingle()

  if (!data) return null
  return (await withContext([data as ArtistFeeInvoice]))[0] ?? null
}

/** Klubbens egne grunnlag, nyeste først. `status` filtrerer når kontrollen vil det. */
export async function listFeeInvoices(opts: { clubId: string; status?: ArtistFeeInvoiceStatus; limit?: number }) {
  const db = createAdminClient()

  let query = db
    .from('artist_fee_invoices')
    .select('*')
    .eq('club_id', opts.clubId)
    .order('issued_at', { ascending: false })
    .limit(opts.limit ?? 50)

  if (opts.status) query = query.eq('status', opts.status)

  const { data } = await query
  return withContext((data ?? []) as ArtistFeeInvoice[])
}

async function withContext(rows: ArtistFeeInvoice[]): Promise<FeeInvoiceContext[]> {
  if (rows.length === 0) return []
  const db = createAdminClient()

  const [{ data: artists }, { data: shows }, { data: clubs }] = await Promise.all([
    db.from('artists').select('id, full_name, stage_name, email, bank_account_number').in('id', [...new Set(rows.map((row) => row.artist_id))]),
    db.from('shows').select('id, title, date, venue_name').in('id', [...new Set(rows.map((row) => row.show_id))]),
    db.from('clubs').select('id, name').in('id', [...new Set(rows.map((row) => row.club_id).filter((id): id is string => Boolean(id)))]),
  ])

  const artistMap = new Map((artists ?? []).map((row) => [row.id, row]))
  const showMap = new Map((shows ?? []).map((row) => [row.id, row]))
  const clubMap = new Map((clubs ?? []).map((row) => [row.id, row]))

  return rows.map((row) => ({
    ...row,
    artist: artistMap.get(row.artist_id) ?? null,
    show: showMap.get(row.show_id) ?? null,
    club: row.club_id ? clubMap.get(row.club_id) ?? null : null,
  }))
}

/**
 * Setter status på et grunnlag.
 *
 * Tidsstemplene er ikke bare pynt: `paid_at` er det dublettkontrollen leser,
 * og skal derfor settes av det samme kallet som setter statusen — ikke av en
 * senere oppdatering noen må huske å gjøre.
 */
export async function setFeeInvoiceStatus(opts: {
  id: string
  /** Klubben som handler. Er grunnlaget en annen klubbs, skjer ingenting. */
  clubId: string
  status: ArtistFeeInvoiceStatus
  handledBy?: string | null
  note?: string | null
}) {
  const db = createAdminClient()
  const now = new Date().toISOString()

  const stamps: Partial<Record<'received_at' | 'approved_at' | 'paid_at', string | null>> =
    opts.status === 'received' ? { received_at: now }
      : opts.status === 'approved' ? { approved_at: now }
        : opts.status === 'paid' ? { paid_at: now }
          // Tilbake til `issued` er en angring: da skal sporene etter
          // behandlingen bort, ellers ser et åpent krav gjort opp ut.
          : opts.status === 'issued' ? { received_at: null, approved_at: null, paid_at: null }
            : {}

  const { data, error } = await db
    .from('artist_fee_invoices')
    .update({
      status: opts.status,
      handled_by: opts.handledBy ?? null,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
      ...stamps,
      updated_at: now,
    })
    .eq('id', opts.id)
    .eq('club_id', opts.clubId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Kunne ikke oppdatere grunnlaget: ${error.message}`)
  // Ingen rad truffet betyr at grunnlaget ikke er klubbens. Det er ikke en
  // teknisk feil, men det skal heller ikke se ut som om noe ble gjort.
  if (!data) throw new Error('Fant ikke fakturagrunnlaget.')
}
