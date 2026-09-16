let sequence = 0

export function resetFactorySequence() {
  sequence = 0
}

export function artistFactory(overrides: Partial<{
  id: string
  status: string
  category: string[]
}> = {}) {
  sequence += 1
  return {
    id: `artist-${sequence}`,
    status: 'approved',
    category: ['stand-up'],
    ...overrides,
  }
}

export function requirementFactory(overrides: Partial<{
  id: string
  role_name: string
  quantity: number
  compensation_type: 'fixed' | 'percent' | null
  compensation_amount: number | null
  compensation_percent: number | null
}> = {}) {
  sequence += 1
  return {
    id: `requirement-${sequence}`,
    role_name: 'Stand-up',
    quantity: 1,
    compensation_type: 'fixed' as const,
    compensation_amount: 100_000,
    compensation_percent: null,
    ...overrides,
  }
}
