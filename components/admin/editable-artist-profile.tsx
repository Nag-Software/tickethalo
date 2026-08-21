'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Input } from '@/components/ui/input'
import { updateArtistProfile } from '@/app/admin-app/artists/[id]/actions'
import { ARTIST_ROLE_OPTIONS, formatArtistRoleSummary, normalizeArtistRoleList } from '@/lib/artist-roles'
import { LANGUAGES, formatLanguageSummary, normalizeLanguages } from '@/lib/languages'
import { shouldBypassImageOptimization } from '@/lib/utils'
import type { Artist } from '@/types/database'

type EditableField = 'full_name' | 'stage_name' | 'email' | 'phone' | 'category' | 'languages' | 'bio' | 'social_links'

type SocialEntry = { key: string; url: string }

function socialLinksToEntries(links: Record<string, string> | null): SocialEntry[] {
  if (!links) return []
  return Object.entries(links).map(([key, url]) => ({ key, url }))
}

function entriesToSocialLinks(entries: SocialEntry[]): Record<string, string> {
  return Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key.trim(), e.url.trim()]))
}

export function EditableArtistProfile({ artist }: { artist: Artist }) {
  const [values, setValues] = useState({
    full_name: artist.full_name,
    stage_name: artist.stage_name ?? '',
    email: artist.email,
    phone: artist.phone ?? '',
    category: normalizeArtistRoleList(artist.category),
    languages: normalizeLanguages(artist.languages),
    bio: artist.bio ?? '',
    social_links: socialLinksToEntries(artist.social_links),
  })
  const [editing, setEditing] = useState<EditableField | null>(null)
  const [isPending, startTransition] = useTransition()
  
  // Autosave setup
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(values)

  function save(field: EditableField, value: unknown) {
    const fd = new FormData()
    fd.set('artist_id', artist.id)
    if (field === 'social_links') {
      fd.set('social_links', JSON.stringify(entriesToSocialLinks(value as SocialEntry[])))
    } else if (field === 'category') {
      fd.set('category_present', '1')
      for (const category of value as string[]) {
        fd.append('category', category)
      }
    } else if (field === 'languages') {
      // Flagget skiller «ingen språk valgt» fra «feltet ble ikke sendt» — uten
      // det kunne man ikke tømme lista igjen.
      fd.set('language_present', '1')
      // Serveren leser feltnavnet `language` (flere ganger), som skjemaene ellers.
      for (const language of value as string[]) {
        fd.append('language', language)
      }
    } else {
      fd.set(field, value as string)
    }
    startTransition(() => updateArtistProfile(fd))
  }

  // Autosave effect
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    
    // Check which fields have changed and save them
    saveTimeoutRef.current = setTimeout(() => {
      const fieldsToSave: EditableField[] = []
      
      ;(Object.keys(values) as EditableField[]).forEach(field => {
        const oldValue = lastSavedRef.current[field]
        const newValue = values[field]
        
        // Deep comparison for social_links
        if (field === 'social_links' || field === 'category' || field === 'languages') {
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            fieldsToSave.push(field)
          }
        } else if (oldValue !== newValue) {
          fieldsToSave.push(field)
        }
      })
      
      // Save each changed field
      fieldsToSave.forEach(field => {
        save(field, values[field])
      })
      
      if (fieldsToSave.length > 0) {
        lastSavedRef.current = JSON.parse(JSON.stringify(values))
      }
    }, 1500) // 1.5 second debounce
    
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [values])

  function handleKeyDown(e: React.KeyboardEvent, field: EditableField) {
    if (e.key === 'Enter' && field !== 'bio') {
      e.preventDefault()
      setEditing(null)
    }
    if (e.key === 'Escape') {
      // Restore original value
      setValues(lastSavedRef.current)
      setEditing(null)
    }
  }

  const cellClass = `cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-muted/60 transition-colors ${isPending ? 'opacity-60' : ''}`

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="font-semibold text-sm">Innsendt profil</h2>
      <div className="flex flex-col gap-4 sm:flex-row">
        {artist.profile_image_url && (
          <Image
            src={artist.profile_image_url}
            alt={artist.full_name}
            width={224}
            height={288}
            sizes="(max-width: 640px) 100vw, 224px"
            unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
            className="h-64 w-full rounded-xl object-cover sm:h-56 sm:w-44 lg:h-72 lg:w-56 shrink-0"
          />
        )}
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm flex-1 sm:grid-cols-2">
          {/* Fullt navn */}
          <EditableFieldRow
            label="Fullt navn"
            isEditing={editing === 'full_name'}
            display={<span className={cellClass} onClick={() => setEditing('full_name')}>{values.full_name || '—'}</span>}
            input={
              <Input
                autoFocus
                value={values.full_name}
                onChange={e => setValues(v => ({ ...v, full_name: e.target.value }))}
                onBlur={() => setEditing(null)}
                onKeyDown={e => handleKeyDown(e, 'full_name')}
                className="h-7 text-sm"
              />
            }
          />

          {/* Scenenavn */}
          <EditableFieldRow
            label="Scenenavn"
            isEditing={editing === 'stage_name'}
            display={<span className={cellClass} onClick={() => setEditing('stage_name')}>{values.stage_name || <em className="text-muted-foreground not-italic">—</em>}</span>}
            input={
              <Input
                autoFocus
                value={values.stage_name}
                onChange={e => setValues(v => ({ ...v, stage_name: e.target.value }))}
                onBlur={() => setEditing(null)}
                onKeyDown={e => handleKeyDown(e, 'stage_name')}
                className="h-7 text-sm"
              />
            }
          />

          {/* E-post */}
          <EditableFieldRow
            label="E-post"
            isEditing={editing === 'email'}
            display={<span className={cellClass} onClick={() => setEditing('email')}>{values.email || '—'}</span>}
            input={
              <Input
                autoFocus
                type="email"
                value={values.email}
                onChange={e => setValues(v => ({ ...v, email: e.target.value }))}
                onBlur={() => setEditing(null)}
                onKeyDown={e => handleKeyDown(e, 'email')}
                className="h-7 text-sm"
              />
            }
          />

          {/* Telefon */}
          <EditableFieldRow
            label="Telefon"
            isEditing={editing === 'phone'}
            display={<span className={cellClass} onClick={() => setEditing('phone')}>{values.phone || <em className="text-muted-foreground not-italic">—</em>}</span>}
            input={
              <Input
                autoFocus
                value={values.phone}
                onChange={e => setValues(v => ({ ...v, phone: e.target.value }))}
                onBlur={() => setEditing(null)}
                onKeyDown={e => handleKeyDown(e, 'phone')}
                className="h-7 text-sm"
              />
            }
          />

          {/* Kategori */}
          <EditableFieldRow
            label="Kategori"
            isEditing={editing === 'category'}
            display={<span className={cellClass} onClick={() => setEditing('category')}>{formatArtistRoleSummary(values.category, '') || <em className="text-muted-foreground not-italic">—</em>}</span>}
            input={
              <div className="space-y-2 rounded-md border border-input bg-background p-2">
                <div className="flex flex-wrap gap-2">
                  {ARTIST_ROLE_OPTIONS.map((role) => {
                    const checked = values.category.includes(role.value)
                    return (
                      <label key={role.value} className="cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setValues((current) => ({
                            ...current,
                            category: checked
                              ? current.category.filter((value) => value !== role.value)
                              : [...current.category, role.value],
                          }))}
                          className="sr-only peer"
                        />
                        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground hover:bg-muted">
                          {role.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground hover:text-foreground">
                  Ferdig
                </button>
              </div>
            }
          />

          {/* Språk */}
          <EditableFieldRow
            label="Språk"
            isEditing={editing === 'languages'}
            display={<span className={cellClass} onClick={() => setEditing('languages')}>{formatLanguageSummary(values.languages) || <em className="text-muted-foreground not-italic">—</em>}</span>}
            input={
              <div className="space-y-2 rounded-md border border-input bg-background p-2">
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((language) => {
                    const checked = values.languages.includes(language.code)
                    return (
                      <label key={language.code} className="cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setValues((current) => ({
                            ...current,
                            languages: checked
                              ? current.languages.filter((value) => value !== language.code)
                              : [...current.languages, language.code],
                          }))}
                          className="sr-only peer"
                        />
                        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground hover:bg-muted">
                          {language.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground hover:text-foreground">
                  Ferdig
                </button>
              </div>
            }
          />

        </div>
      </div>

      {/* Bio */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">Bio</p>
        {editing === 'bio' ? (
          <textarea
            autoFocus
            value={values.bio}
            onChange={e => setValues(v => ({ ...v, bio: e.target.value }))}
            onBlur={() => setEditing(null)}
            onKeyDown={e => handleKeyDown(e, 'bio')}
            rows={4}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        ) : (
          <p
            className={`text-sm whitespace-pre-wrap min-h-[1.5rem] ${cellClass}`}
            onClick={() => setEditing('bio')}
          >
            {values.bio || <em className="text-muted-foreground not-italic">Klikk for å legge til bio...</em>}
          </p>
        )}
      </div>

      {/* Social links */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Sosiale lenker</p>
          {editing !== 'social_links' && (
            <button
              onClick={() => setEditing('social_links')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Rediger
            </button>
          )}
        </div>
        {editing === 'social_links' ? (
          <div className="space-y-2">
            {values.social_links.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="nøkkel (f.eks. instagram)"
                  value={entry.key}
                  onChange={e => {
                    const updated = [...values.social_links]
                    updated[i] = { ...updated[i], key: e.target.value }
                    setValues(v => ({ ...v, social_links: updated }))
                  }}
                  className="h-7 text-sm w-32"
                />
                <Input
                  placeholder="https://..."
                  value={entry.url}
                  onChange={e => {
                    const updated = [...values.social_links]
                    updated[i] = { ...updated[i], url: e.target.value }
                    setValues(v => ({ ...v, social_links: updated }))
                  }}
                  className="h-7 text-sm flex-1"
                />
                <button
                  onClick={() => setValues(v => ({ ...v, social_links: v.social_links.filter((_, j) => j !== i) }))}
                  className="text-xs text-destructive hover:text-destructive/80 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setValues(v => ({ ...v, social_links: [...v.social_links, { key: '', url: '' }] }))}
                className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1"
              >
                + Legg til lenke
              </button>
              <button
                onClick={() => setEditing(null)}
                className="text-xs border rounded px-2 py-1 hover:bg-muted"
              >
                Ferdig
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {values.social_links.length > 0
              ? values.social_links.map((entry) => (
                  <a
                    key={entry.key}
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    {entry.key}
                  </a>
                ))
              : <span className={`text-sm ${cellClass}`} onClick={() => setEditing('social_links')}><em className="text-muted-foreground not-italic">Ingen lenker</em></span>
            }
          </div>
        )}
      </div>

      {isPending && (
        <p className="text-xs text-muted-foreground animate-pulse">Lagrer...</p>
      )}
    </section>
  )
}

function EditableFieldRow({
  label,
  isEditing,
  display,
  input,
}: {
  label: string
  isEditing: boolean
  display: React.ReactNode
  input: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="font-medium mt-0.5">
        {isEditing ? input : display}
      </div>
    </div>
  )
}
