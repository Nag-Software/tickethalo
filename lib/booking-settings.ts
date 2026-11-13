/**
 * Innstillingene bookingmotoren kjører på.
 *
 * Alt som kan justeres uten en ny versjon av systemet står i én rad i
 * `booking_scoring_config` (`id = 'default'`). Superadmin redigerer den på
 * /superadmin/booking; motoren leser den ved hver kjøring.
 *
 * Grensene under er ikke pynt. En rad som er skrevet feil — i et skjema, i
 * en konsoll eller av en migrasjon — flytter seg rett ut i e-poster til
 * ekte komikere. `clampBookingSettings` kjøres derfor både når verdiene
 * lagres og når de leses, så motoren aldri regner på et tall utenfor det
 * som gir mening. Se `parseBookingSettings` for meldingene bookeren får.
 */

export type BookingSettings = {
  /** Poeng en score på 10 er verdt. Score × vekt / 10. */
  quality_weight: number
  /** Trekk per bekreftet plass komikeren har i samme klubb i vinduet. */
  rotation_penalty: number
  rotation_window_days: number
  /** To show samme dato kolliderer når starttidene er nærmere enn dette. */
  conflict_window_hours: number
  /** Nye tilbud per ledig sete per dag. */
  offers_per_day: number
  /** Taket: aktive tilbud fra motoren på ett sete. */
  offers_per_slot: number
  offer_response_days: number
  /** Svarfrist på tilbud sendt etter lineup-fristen. */
  late_offer_response_hours: number
  /** Dager før lineup-fristen der motoren sender alt med en gang. */
  rush_days: number
  /** Timer igjen av svarfristen når påminnelsen går. */
  reminder_hours: number
  /** Plattformens standard. Klubben kan overstyre den på Min klubb. */
  lineup_deadline_days: number
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  quality_weight: 100,
  rotation_penalty: 10,
  rotation_window_days: 30,
  conflict_window_hours: 3,
  offers_per_day: 2,
  offers_per_slot: 10,
  offer_response_days: 7,
  late_offer_response_hours: 48,
  rush_days: 5,
  reminder_hours: 48,
  lineup_deadline_days: 14,
}

export type BookingSettingKey = keyof BookingSettings

export type BookingSettingField = {
  key: BookingSettingKey
  label: string
  unit: string
  help: string
  min: number
  max: number
  step: number
  /** Desimaler tillatt. Alt annet rundes til hele tall. */
  decimals: boolean
}

/**
 * Rekkefølgen feltene står i på superadmin-siden, og grensene de holdes
 * innenfor. Teksten er den samme som i docs/booking-algoritmen.md, punkt 13.
 */
export const BOOKING_SETTING_FIELDS: BookingSettingField[] = [
  {
    key: 'offers_per_day',
    label: 'New offers per spot per day',
    unit: 'offers',
    help: 'On the first day the best get the offer. Every morning the number grows by this much, up to the cap below.',
    min: 1, max: 10, step: 1, decimals: false,
  },
  {
    key: 'offers_per_slot',
    label: 'Max open offers on one spot',
    unit: 'offers',
    help: 'The cap on how many can be waiting to answer for the same spot at once.',
    min: 1, max: 50, step: 1, decimals: false,
  },
  {
    key: 'offer_response_days',
    label: 'Response deadline',
    unit: 'days',
    help: 'How long an offer stays open. Never longer than the lineup deadline, and never past the show date.',
    min: 1, max: 60, step: 1, decimals: false,
  },
  {
    key: 'reminder_hours',
    label: 'Reminder before the deadline',
    unit: 'hours',
    help: 'The comedian gets one email when this much of the deadline is left. 0 turns the reminder off.',
    min: 0, max: 168, step: 1, decimals: false,
  },
  {
    key: 'lineup_deadline_days',
    label: 'Lineup deadline before the show',
    unit: 'days',
    help: 'The default for every club. Each club can set its own under My club.',
    min: 1, max: 120, step: 1, decimals: false,
  },
  {
    key: 'rush_days',
    label: 'Send everything from',
    unit: 'days before the deadline',
    help: 'This close to the lineup deadline the engine stops stepping up and sends all offers at once.',
    min: 0, max: 60, step: 1, decimals: false,
  },
  {
    key: 'late_offer_response_hours',
    label: 'Response deadline after the lineup deadline',
    unit: 'hours',
    help: 'A shorter deadline once the lineup deadline has passed. Offers never go out later than the day before the show.',
    min: 1, max: 168, step: 1, decimals: false,
  },
  {
    key: 'rotation_penalty',
    label: 'Penalty per show at the same club',
    unit: 'points',
    help: '10 points is one score point. Spreads the bookings so audiences see more faces.',
    min: 0, max: 100, step: 1, decimals: false,
  },
  {
    key: 'rotation_window_days',
    label: 'Window for that penalty',
    unit: 'days',
    help: 'How many days before and after the show date the engine looks for other spots at the club.',
    min: 0, max: 365, step: 1, decimals: false,
  },
  {
    key: 'conflict_window_hours',
    label: 'Clash between two shows',
    unit: 'hours',
    help: 'If two shows on the same day start closer together than this, the same comedian can’t take both. If either has no start time, the whole day counts.',
    min: 0, max: 24, step: 0.5, decimals: true,
  },
  {
    key: 'quality_weight',
    label: 'Score weight',
    unit: 'points for score 10',
    help: 'How much quality counts against the rotation penalty. 100 gives 10 points per score point.',
    min: 0, max: 1000, step: 10, decimals: false,
  },
]

const FIELD_BY_KEY = new Map(BOOKING_SETTING_FIELDS.map((field) => [field.key, field]))

function clampOne(key: BookingSettingKey, value: unknown): number {
  const field = FIELD_BY_KEY.get(key)
  const fallback = DEFAULT_BOOKING_SETTINGS[key]
  if (!field) return fallback

  // `Number(null)` er 0, som er et helt gyldig tall. En kolonne som står på
  // NULL — fordi migrasjonen ikke rakk å fylle den, eller noen tømte den —
  // ville da blitt lest som «null tilbud per dag» i stedet for standarden.
  if (value == null || value === '') return fallback

  const raw = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(raw)) return fallback

  const rounded = field.decimals ? Math.round(raw * 10) / 10 : Math.round(raw)
  return Math.min(field.max, Math.max(field.min, rounded))
}

/**
 * Tallene motoren faktisk får lov til å regne på.
 *
 * Kjøres på vei inn i databasen og på vei ut igjen. En kolonne som er
 * endret utenom skjemaet — direkte i basen, eller av en migrasjon som
 * bommer — skal ikke kunne sende 500 e-poster på en plass.
 */
export function clampBookingSettings(raw: Partial<Record<BookingSettingKey, unknown>> | null | undefined): BookingSettings {
  const settings = Object.fromEntries(
    BOOKING_SETTING_FIELDS.map((field) => [field.key, clampOne(field.key, raw?.[field.key])]),
  ) as BookingSettings

  // En dagsbølge større enn taket er ikke farlig, men den betyr at
  // opptrappingen er slått av uten at noen har sagt det. Da er taket det
  // som gjelder, og skjemaet sier fra.
  settings.offers_per_day = Math.min(settings.offers_per_day, settings.offers_per_slot)

  return settings
}

export type BookingSettingsIssue = { key: BookingSettingKey; message: string }

/**
 * Leser skjemaet fra superadmin.
 *
 * Verdier utenfor grensene avvises i stedet for å klippes i det stille —
 * den som skriver 400 i «maks tilbud» skal få vite at taket er 50, ikke
 * oppdage det ved å se at det står 50 etterpå.
 */
export function parseBookingSettings(
  input: Partial<Record<BookingSettingKey, unknown>>,
): { settings: BookingSettings; issues: BookingSettingsIssue[] } {
  const issues: BookingSettingsIssue[] = []
  const values: Partial<Record<BookingSettingKey, number>> = {}

  for (const field of BOOKING_SETTING_FIELDS) {
    const rawValue = input[field.key]
    const text = String(rawValue ?? '').trim().replace(',', '.')

    if (text.length === 0) {
      issues.push({ key: field.key, message: `${field.label} is required.` })
      continue
    }

    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      issues.push({ key: field.key, message: `${field.label} must be a number.` })
      continue
    }

    if (!field.decimals && !Number.isInteger(parsed)) {
      issues.push({ key: field.key, message: `${field.label} must be a whole number.` })
      continue
    }

    if (parsed < field.min || parsed > field.max) {
      issues.push({
        key: field.key,
        message: `${field.label} must be between ${field.min} and ${field.max} ${field.unit}.`,
      })
      continue
    }

    values[field.key] = field.decimals ? Math.round(parsed * 10) / 10 : parsed
  }

  const perDay = values.offers_per_day
  const perSlot = values.offers_per_slot
  if (perDay != null && perSlot != null && perDay > perSlot) {
    issues.push({
      key: 'offers_per_day',
      message: 'Offers per day can’t be more than the cap on open offers per spot.',
    })
  }

  return { settings: clampBookingSettings(values), issues }
}

/** Lineup-fristen som gjelder for klubben. Null på klubben = plattformens. */
export function lineupDeadlineDaysFor(
  club: { lineup_deadline_days?: number | null } | null | undefined,
  settings: BookingSettings,
): number {
  const own = club?.lineup_deadline_days
  if (own == null) return settings.lineup_deadline_days
  return Math.min(120, Math.max(1, Math.round(own)))
}
