'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { decodeCsvBytes, parseCsv, type ParsedCsv } from '@/lib/marketing/csv'
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_MAX_ROWS,
  SKIP_REASON_LABELS,
  guessColumnMapping,
  importConsentStatement,
  prepareImportRows,
  skippedRowsCsv,
  withHeaderRow,
  type ColumnMapping,
  type SkippedRow,
} from '@/lib/marketing/contacts'
import { importContactsAction } from './actions'

/**
 * Import av en kontaktliste, i samme rekkefølge som hos Mailchimp: velg fil,
 * se at kolonnene er riktige, bekreft samtykket, importer, les rapporten.
 *
 * Fila leses her i nettleseren. Det klubben ser i forhåndsvisningen er det
 * som sendes, og serveren får bare de radene som skal inn — i biter, så en
 * stor liste ikke sprenger grensen for én server action.
 */

type Loaded = { fileName: string; table: ParsedCsv & { hasHeaderRow: boolean } }
type Report = { added: number; updated: number; alreadyOnList: number; skipped: SkippedRow[] }

const FIELDS: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: 'email', label: 'Email', required: true },
  { key: 'name', label: 'Full name' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'phone', label: 'Phone' },
]

export function ImportContactsButton({ clubName }: { clubName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload />
        Import CSV
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
          {/* Ny dialog hver gang den åpnes: en halvferdig import skal ikke stå igjen. */}
          {open && <ImportFlow clubName={clubName} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ImportFlow({ clubName, onDone }: { clubName: string; onDone: () => void }) {
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [consent, setConsent] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  const prepared = useMemo(() => {
    if (!loaded || !mapping || mapping.email === null) return null
    return prepareImportRows(loaded.table.rows, mapping, { firstLine: loaded.table.hasHeaderRow ? 2 : 1 })
  }, [loaded, mapping])

  async function readFile(file: File) {
    setReadError(null)
    try {
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
      const table = withHeaderRow(parseCsv(text))
      if (table.rows.length === 0) {
        setReadError('The file has no rows.')
        return
      }
      if (table.rows.length > IMPORT_MAX_ROWS) {
        setReadError(`The file has ${table.rows.length.toLocaleString('en-GB')} rows. Import at most ${IMPORT_MAX_ROWS.toLocaleString('en-GB')} at a time.`)
        return
      }
      setLoaded({ fileName: file.name, table })
      setMapping(guessColumnMapping(table))
    } catch {
      setReadError('Could not read the file. Save it as CSV from Excel, Google Sheets or Mailchimp and try again.')
    }
  }

  async function runImport() {
    if (!prepared || !loaded) return
    setImportError(null)
    const chunks: (typeof prepared.valid)[] = []
    for (let index = 0; index < prepared.valid.length; index += IMPORT_CHUNK_SIZE) {
      chunks.push(prepared.valid.slice(index, index + IMPORT_CHUNK_SIZE))
    }

    const total: Report = { added: 0, updated: 0, alreadyOnList: 0, skipped: [...prepared.skipped] }
    let importId: string | null = null
    setProgress({ done: 0, total: prepared.valid.length })

    for (const rows of chunks) {
      const result = await importContactsAction({
        importId,
        fileName: loaded.fileName,
        consentConfirmed: consent,
        rowsTotal: loaded.table.rows.length,
        skippedInFile: prepared.skipped.length,
        rows,
      })
      if ('error' in result) {
        setImportError(
          total.added + total.updated > 0
            ? `${result.error} ${total.added + total.updated} contacts were imported before it stopped.`
            : result.error,
        )
        setProgress(null)
        setReport(total.added + total.updated > 0 ? total : null)
        router.refresh()
        return
      }
      importId = result.importId
      total.added += result.added
      total.updated += result.updated
      total.alreadyOnList += result.alreadyOnList
      total.skipped.push(...result.skipped)
      setProgress((current) => current && { ...current, done: current.done + rows.length })
    }

    total.skipped.sort((a, b) => a.line - b.line)
    setProgress(null)
    setReport(total)
    router.refresh()
  }

  function downloadSkipped(skipped: SkippedRow[]) {
    const blob = new Blob([`﻿${skippedRowsCsv(skipped)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'skipped-rows.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (report) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <DialogTitle className="text-lg font-semibold">Import finished</DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground">
            {loaded?.fileName}
          </DialogDescription>
        </div>
        {importError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{importError}</p>}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Added" value={report.added} />
          <Stat label="Updated" value={report.updated} hint="Name or phone filled in" />
          <Stat label="Already on list" value={report.alreadyOnList} />
          <Stat label="Skipped" value={report.skipped.length} />
        </dl>
        {report.skipped.length > 0 && <SkippedList skipped={report.skipped} onDownload={() => downloadSkipped(report.skipped)} />}
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    )
  }

  if (!loaded || !mapping) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <DialogTitle className="text-lg font-semibold">Import contacts</DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground">
            Upload a CSV file from Excel, Google Sheets, Mailchimp or another ticketing system. You choose which
            columns to use in the next step.
          </DialogDescription>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors hover:bg-muted/40">
          <FileUp className="size-6 text-muted-foreground" />
          <span className="font-medium">Choose a CSV file</span>
          <span className="text-xs text-muted-foreground">Comma or semicolon separated. The first row can be column names.</span>
          <input
            type="file"
            accept=".csv,.txt,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readFile(file)
            }}
          />
        </label>
        {readError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{readError}</p>}
      </div>
    )
  }

  const headers = loaded.table.headers
  const preview = (prepared?.valid ?? []).slice(0, 5)
  const importing = progress !== null
  const canImport = Boolean(prepared && prepared.valid.length > 0 && consent && !importing)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <DialogTitle className="text-lg font-semibold">Match columns</DialogTitle>
        <DialogDescription className="mt-1 text-muted-foreground">
          {loaded.fileName} · {loaded.table.rows.length.toLocaleString('en-GB')} rows
          {!loaded.table.hasHeaderRow && ' · no column names found, the first row is imported too'}
        </DialogDescription>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {field.label}
              {field.required && ' (required)'}
            </span>
            <select
              value={mapping[field.key] ?? ''}
              disabled={importing}
              onChange={(event) => {
                const value = event.target.value === '' ? null : Number(event.target.value)
                setMapping({ ...mapping, [field.key]: value })
              }}
              className="h-10 rounded-lg border bg-card px-3 text-sm outline-none focus:border-[var(--ev-accent-fill)]"
            >
              <option value="">{field.required ? 'Choose a column' : 'Not in file'}</option>
              {headers.map((header, index) => (
                <option key={index} value={index}>
                  {header || `Column ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {mapping.email === null ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
          Choose the column with email addresses.
        </p>
      ) : (
        prepared && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-semibold">{prepared.valid.length.toLocaleString('en-GB')}</span> contacts ready to import
              {prepared.skipped.length > 0 && (
                <span className="text-muted-foreground"> · {prepared.skipped.length} rows will be skipped</span>
              )}
            </p>
            {preview.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30 text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Email</th>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.email} className="border-b last:border-0">
                        <td className="px-3 py-2">{row.email}</td>
                        <td className="px-3 py-2">{row.name ?? '—'}</td>
                        <td className="px-3 py-2">{row.phone ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {prepared.skipped.length > 0 && (
              <SkippedList skipped={prepared.skipped} onDownload={() => downloadSkipped(prepared.skipped)} />
            )}
          </div>
        )
      )}

      {/* Grunnlaget for å sende (markedsføringsloven § 15): klubben bekrefter
          at folkene har sagt ja. Teksten lagres på importen. */}
      <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <input
          type="checkbox"
          checked={consent}
          disabled={importing}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--ev-accent-fill)]"
        />
        <span>
          <span className="font-medium">{importConsentStatement(clubName)}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Only import people who have said yes to emails from you — for example on a sign-up list or in another
            ticketing system. People who have unsubscribed from your list are never added again.
          </span>
        </span>
      </label>

      {importError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{importError}</p>}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          disabled={importing}
          onClick={() => {
            setLoaded(null)
            setMapping(null)
            setConsent(false)
          }}
        >
          Choose another file
        </Button>
        <Button disabled={!canImport} onClick={() => void runImport()}>
          {importing
            ? `Importing… ${progress.done.toLocaleString('en-GB')} / ${progress.total.toLocaleString('en-GB')}`
            : `Import ${(prepared?.valid.length ?? 0).toLocaleString('en-GB')} contacts`}
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString('en-GB')}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  )
}

function SkippedList({ skipped, onDownload }: { skipped: SkippedRow[]; onDownload: () => void }) {
  return (
    <div className="rounded-lg border">
      <ul className="max-h-40 divide-y overflow-y-auto text-xs">
        {skipped.slice(0, 50).map((row) => (
          <li key={`${row.line}-${row.reason}`} className="flex gap-3 px-3 py-2">
            <span className="w-14 shrink-0 tabular-nums text-muted-foreground">Row {row.line}</span>
            <span className="min-w-0 flex-1 truncate">{row.value || '—'}</span>
            <span className="shrink-0 text-muted-foreground">{SKIP_REASON_LABELS[row.reason]}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span>{skipped.length > 50 ? `Showing 50 of ${skipped.length}` : `${skipped.length} skipped`}</span>
        <button type="button" onClick={onDownload} className="font-medium text-foreground hover:underline">
          Download skipped rows
        </button>
      </div>
    </div>
  )
}
