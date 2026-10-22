import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/events/actions', () => ({ startCheckoutAction: vi.fn(), unlockTicketTypesAction: vi.fn() }))

import { MarketingConsent } from '@/components/public/ticket-order'

const EMAILS = 'Yes, send me emails from Crønch Comedy about upcoming shows.'
const ADS = 'Show me relevant ads from Crønch Comedy on Facebook and Instagram.'

describe('checkout consent boxes', () => {
  it('starts with both off and the ads box hidden', () => {
    render(<MarketingConsent clubName="Crønch Comedy" />)
    expect(screen.getByRole('checkbox', { name: EMAILS })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: ADS })).toBeNull()
  })

  it('shows the ads box only once the email box is ticked, and clears it with the email box', () => {
    render(<MarketingConsent clubName="Crønch Comedy" />)
    const emails = screen.getByRole('checkbox', { name: EMAILS })

    fireEvent.click(emails)
    const ads = screen.getByRole('checkbox', { name: ADS })
    expect(ads).not.toBeChecked()
    expect(ads).toHaveAttribute('name', 'ads_opt_in')

    fireEvent.click(ads)
    expect(ads).toBeChecked()

    fireEvent.click(emails)
    expect(screen.queryByRole('checkbox', { name: ADS })).toBeNull()

    fireEvent.click(emails)
    expect(screen.getByRole('checkbox', { name: ADS })).not.toBeChecked()
  })
})
