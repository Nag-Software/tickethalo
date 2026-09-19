/**
 * Det event-siden trenger før den er verdt å vise frem.
 *
 * Showet publiserte seg selv i det lineupen ble full, og gikk ut uten plakat,
 * tekst og billettpris. Nå publiserer klubben selv, og denne listen er det
 * både e-posten («Line-up is booked – Publish?») og publiser-knappen leser,
 * så de to aldri er uenige om hva som gjenstår.
 *
 * Ingenting her *sperrer* publisering. Det er klubbens kveld: vil de ut uten
 * plakat, får de det — men da har de sett at den mangler. Det som faktisk
 * sperrer (full lineup, ferdig utbetalingsoppsett) ligger i `publishShow`.
 */

export type PublishReadinessShow = {
  poster_url: string | null
  description: string | null
  ticket_price: number | null
}

export type PublishReadinessItem = {
  key: 'poster' | 'description' | 'ticket_price'
  /** Slik det står i en sjekkliste: «Poster». */
  label: string
  /** Slik det står i en setning: «a poster». */
  phrase: string
  done: boolean
}

export function publishReadiness(show: PublishReadinessShow): PublishReadinessItem[] {
  return [
    { key: 'poster', label: 'Poster', phrase: 'a poster', done: Boolean(show.poster_url) },
    { key: 'description', label: 'Description', phrase: 'a description', done: Boolean(show.description?.trim()) },
    // Pris 0 er et gratisshow og et bevisst valg. Bare et tomt felt mangler.
    { key: 'ticket_price', label: 'Ticket price', phrase: 'a ticket price', done: show.ticket_price != null },
  ]
}

export function missingForPublish(show: PublishReadinessShow): PublishReadinessItem[] {
  return publishReadiness(show).filter((item) => !item.done)
}
