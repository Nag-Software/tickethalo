'use client'

import { useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/**
 * «Export CSV» og «Export for Meta».
 *
 * Nedlastingene er vanlige `<a download>` mot eksportruten, ikke `Link`: en
 * `Link` forhåndshentes, og hver henting logges som en eksport.
 *
 * Meta-eksporten får en dialog først. Det er en utlevering til en ny mottaker,
 * og klubben skal vite hva fila er, hvor den skal, og hvorfor den kan være tom.
 */

const META_AUDIENCES_URL = 'https://adsmanager.facebook.com/adsmanager/audiences'

export function ExportButtons({ exportHref, adsAudience, clubName }: { exportHref: string; adsAudience: number; clubName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" asChild>
        <a href={exportHref} download>
          <Download />
          Export CSV
        </a>
      </Button>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Download />
        Export for Meta
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <div className="flex flex-col gap-4">
            <div>
              <DialogTitle className="text-lg font-semibold">Export for Meta</DialogTitle>
              <DialogDescription className="mt-1 text-muted-foreground">
                A customer list for a Custom Audience on Facebook and Instagram.
              </DialogDescription>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-3xl font-semibold tabular-nums">{adsAudience.toLocaleString('en-GB')}</div>
              <div className="text-sm text-muted-foreground">
                {adsAudience === 1 ? 'contact has' : 'contacts have'} said yes to ads from {clubName}
              </div>
            </div>

            {adsAudience === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one yet. Saying yes to emails is not saying yes to ads, so only people who ticked “Show me relevant
                ads” at checkout — a box that starts now — are included. You can also import people who agreed to ads
                elsewhere, with the extra confirmation in the import.
              </p>
            ) : (
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                <li>Only people who said yes to ads and have not withdrawn it or unsubscribed.</li>
                <li>Email, phone, first name, last name and country, in the format Meta asks for.</li>
                <li>Meta hashes the data when you upload it and uses it only to find matching accounts.</li>
                <li>
                  Replace the audience each time instead of adding to it, so people who withdrew are removed from Meta
                  too.
                </li>
              </ul>
            )}

            <p className="text-sm">
              Upload in Meta Ads Manager: Audiences → Create audience → Custom audience → Customer list.{' '}
              <a
                href={META_AUDIENCES_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
              >
                Open Audiences
                <ExternalLink className="size-3.5" />
              </a>
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
              {adsAudience > 0 ? (
                <Button asChild>
                  <a href="/admin-app/marketing/export?kind=meta" download onClick={() => setOpen(false)}>
                    <Download />
                    Download {adsAudience.toLocaleString('en-GB')} contacts
                  </a>
                </Button>
              ) : (
                <Button disabled>
                  <Download />
                  Nothing to download
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
