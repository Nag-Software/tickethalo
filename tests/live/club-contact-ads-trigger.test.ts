import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// `pg` brukes ellers bare av scripts/migrate.mjs og har ingen typer i
// prosjektet. Det lille som trengs her, beskrives her.
type Client = {
  connect(): Promise<void>
  end(): Promise<void>
  query<R = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: R[] }>
}
const { Client } = createRequire(import.meta.url)('pg') as {
  Client: new (config: { connectionString?: string; ssl?: { rejectUnauthorized: boolean } }) => Client
}

/**
 * Triggerne fra migrasjon 077 og 090 mot den ekte basen.
 *
 * Alt skjer i én transaksjon som rulles tilbake til slutt: ordrene og
 * kontaktene finnes bare her inne, og ingen andre ser dem. Kjøres med
 * `pnpm test:live` og DATABASE_URL satt, etter at 090 er kjørt.
 */

const url = process.env.DATABASE_URL
const EMAIL = `ads-trigger-${Date.now()}@example.test`

let client: Client
let clubId: string

type ContactRow = {
  consent_at: string | null
  unsubscribed_at: string | null
  ads_consent_at: string | null
  ads_consent_source: string | null
  ads_consent_text: string | null
  ads_consent_order_id: string | null
  ads_withdrawn_at: string | null
}

async function order(fields: { marketing: boolean; ads?: boolean }) {
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (club_id, buyer_email, buyer_name, status, marketing_opt_in, marketing_opt_in_at, amount_total)
     values ($1, $2, 'Ada Test', 'paid', $3, now(), 0) returning id`,
    [clubId, EMAIL.toUpperCase(), fields.marketing],
  )
  const id = rows[0].id
  // Som `recordAdsOptIn`: krysset settes etter at ordren finnes.
  if (fields.ads) {
    await client.query(
      `update orders set ads_opt_in = true, ads_opt_in_at = now() where id = $1 and marketing_opt_in and not ads_opt_in`,
      [id],
    )
  }
  return id
}

async function contact(): Promise<ContactRow | undefined> {
  const { rows } = await client.query<ContactRow>(
    `select consent_at, unsubscribed_at, ads_consent_at, ads_consent_source, ads_consent_text, ads_consent_order_id, ads_withdrawn_at
     from club_contacts where club_id = $1 and email = $2`,
    [clubId, EMAIL],
  )
  return rows[0]
}

describe.skipIf(!url)('club contact triggers (090)', () => {
  beforeAll(async () => {
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
    await client.query('begin')
    const { rows } = await client.query<{ id: string }>('select id from clubs order by created_at limit 1')
    clubId = rows[0].id
  })

  afterAll(async () => {
    await client?.query('rollback')
    await client?.end()
  })

  it('gives no ads consent for a box that was not ticked, and ignores ads without emails', async () => {
    await order({ marketing: false, ads: true })
    expect(await contact()).toBeUndefined()

    await order({ marketing: true })
    expect(await contact()).toMatchObject({ ads_consent_at: null, ads_consent_source: null, ads_withdrawn_at: null })
  })

  it('records ads consent with the words and the order when both boxes are ticked', async () => {
    const orderId = await order({ marketing: true, ads: true })
    const row = await contact()
    expect(row?.ads_consent_at).not.toBeNull()
    expect(row).toMatchObject({ ads_consent_source: 'purchase', ads_consent_order_id: orderId, ads_withdrawn_at: null })
    expect(row?.ads_consent_text).toMatch(/^Show me relevant ads from .+ on Facebook and Instagram\.$/)
  })

  it('leaves ads consent alone on a later order with only the email box', async () => {
    const before = await contact()
    await order({ marketing: true })
    expect(await contact()).toMatchObject({
      ads_consent_at: before?.ads_consent_at,
      ads_consent_order_id: before?.ads_consent_order_id,
      ads_withdrawn_at: null,
    })
  })

  it('withdraws ads consent when the contact unsubscribes, and does not give it back on resubscribe', async () => {
    await client.query(`update club_contacts set unsubscribed_at = now() where club_id = $1 and email = $2`, [clubId, EMAIL])
    const unsubscribed = await contact()
    expect(unsubscribed?.ads_withdrawn_at).not.toBeNull()
    expect(unsubscribed?.ads_withdrawn_at).toEqual(unsubscribed?.unsubscribed_at)

    await client.query(`update club_contacts set unsubscribed_at = null where club_id = $1 and email = $2`, [clubId, EMAIL])
    expect((await contact())?.ads_withdrawn_at).not.toBeNull()
  })

  it('takes a new yes at checkout as a new ads consent', async () => {
    const orderId = await order({ marketing: true, ads: true })
    expect(await contact()).toMatchObject({ unsubscribed_at: null, ads_withdrawn_at: null, ads_consent_order_id: orderId })
  })

  it('rejects ads consent without a source', async () => {
    await client.query('savepoint bad_source')
    await expect(
      client.query(`update club_contacts set ads_consent_source = null where club_id = $1 and email = $2`, [clubId, EMAIL]),
    ).rejects.toThrow(/club_contacts_ads_consent_source_check/)
    await client.query('rollback to savepoint bad_source')
  })
})
