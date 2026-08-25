'use client'

import { useRouter } from 'next/navigation'
import { BarChart3, MapPin } from 'lucide-react'
import { SearchableSelect, type SelectOption } from '@/components/searchable-select'
import { Label } from '@/components/ui/label'

export type DiscoverSort = 'bookings' | 'name' | 'newest'

const SORT_OPTIONS: SelectOption[] = [
  { value: 'bookings', label: 'Most bookings' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'newest', label: 'Newest first' },
]

/**
 * Katalogens to valg.
 *
 * Et valg som må bekreftes med en knapp er ett klikk for mye i en liste man
 * blar i, så de navigerer ved endring. Klient-komponent bare av den grunn —
 * kortene og tallene rendres på serveren.
 */
export function DiscoverFilters({
  cities,
  city,
  sort,
  query,
}: {
  /** Byene i katalogen, med antall komikere i hver. */
  cities: { city: string; count: number }[]
  city: string
  sort: DiscoverSort
  /** Navnesøket. Følger med når filteret endres. */
  query: string
}) {
  const router = useRouter()

  function go(next: { city?: string; sort?: DiscoverSort }) {
    const params = new URLSearchParams()
    const nextCity = next.city ?? city
    const nextSort = next.sort ?? sort

    if (query.trim()) params.set('q', query.trim())
    if (nextCity) params.set('city', nextCity)
    if (nextSort !== 'bookings') params.set('sort', nextSort)

    const search = params.toString()
    router.push(search ? `/admin-app/discover?${search}` : '/admin-app/discover')
  }

  const cityOptions: SelectOption[] = [
    { value: '', label: 'All locations' },
    ...cities.map(({ city: name, count }) => ({ value: name, label: name, hint: String(count) })),
  ]

  return (
    <>
      <div className="flex w-full flex-col gap-1.5 sm:w-56">
        <Label htmlFor="discover-location">Location</Label>
        <SearchableSelect
          id="discover-location"
          value={city}
          options={cityOptions}
          onSelect={(next) => go({ city: next })}
          placeholder="All locations"
          searchPlaceholder="Search city"
          icon={<MapPin className="size-4 shrink-0 text-muted-foreground" />}
          className="w-full"
        />
      </div>

      <div className="flex w-full flex-col gap-1.5 sm:w-52">
        <Label htmlFor="discover-sort">Sort by</Label>
        <SearchableSelect
          id="discover-sort"
          value={sort}
          options={SORT_OPTIONS}
          onSelect={(next) => go({ sort: next as DiscoverSort })}
          icon={<BarChart3 className="size-4 shrink-0 text-muted-foreground" />}
          className="w-full"
        />
      </div>
    </>
  )
}
