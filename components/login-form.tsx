"use client"

import { useEffect } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  title = "Login to your account",
  description = "Enter your email below to login to your account",
  action = "#",
  errorMessage,
  brandLabel,
  brandHref = '/',
  showSignupLink = true,
  signupHref = '/signup',
  nextPath,
  theme = 'default',
  ...props
}: React.ComponentProps<"div"> & {
  title?: string
  description?: string
  action?: string
  errorMessage?: string
  brandLabel?: string
  brandHref?: string
  showSignupLink?: boolean
  signupHref?: string
  nextPath?: string
  theme?: 'default' | 'poster' | 'artist'
}) {
  useEffect(() => {
    if (errorMessage) toast.error(errorMessage)
  }, [errorMessage])

  const isPoster = theme === 'poster'
  const isArtist = theme === 'artist'

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className={cn(
        'shadow-sm',
        isPoster
          ? 'rounded-none border-2 border-zinc-950 bg-[#fbf7ec] shadow-[8px_8px_0_rgba(24,24,27,0.14)]'
          : isArtist
            ? 'gap-0 rounded-2xl bg-card p-0 ring-1 ring-vipps-orange/10 shadow-lg'
            : 'rounded-lg',
      )}>
        <CardHeader className={cn(
          'space-y-0',
          isPoster && 'border-b-2 border-zinc-950 px-6 py-5',
          isArtist && 'border-b border-border px-6 py-5',
        )}>
          {brandLabel && (
            <Link href={brandHref} className={cn(
              'mb-3 inline-flex text-sm font-bold',
              isPoster
                ? 'mx-auto border border-zinc-950 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-zinc-950'
                : isArtist
                  ? 'text-xs font-semibold uppercase tracking-wide text-vipps-orange-80'
                  : 'mx-auto rounded-full bg-amber-100 px-2.5 py-1 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
            )}>
              {brandLabel}
            </Link>
          )}
          <CardTitle className={cn(
            isPoster && 'text-2xl font-black uppercase tracking-tight',
            isArtist && 'text-2xl font-semibold tracking-tight',
          )}>{title}</CardTitle>
          <CardDescription className={cn(
            isPoster && 'mt-1 text-sm font-medium text-zinc-600',
            isArtist && 'mt-1 text-sm text-muted-foreground',
          )}>{description}</CardDescription>
        </CardHeader>
        <CardContent className={cn(isPoster && 'px-6 py-5', isArtist && 'px-6 py-5')}>
          <form action={action} method="post">
            <FieldGroup>
              {nextPath && <input type="hidden" name="next" value={nextPath} />}
              {errorMessage && (
                <div className={cn(
                  'px-3 py-2 text-sm',
                  isPoster
                    ? 'border-2 border-[#b83224] bg-white text-[#b83224]'
                    : isArtist
                      ? 'rounded-xl border border-destructive/20 bg-destructive/10 text-destructive'
                      : 'rounded-md bg-destructive/10 text-destructive',
                )}>
                  {errorMessage}
                </div>
              )}
              <Field>
                <FieldLabel htmlFor="email" className={cn(isArtist && 'text-sm font-medium text-foreground')}>
                  E-post
                </FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={cn(
                    isPoster && 'h-11 rounded-none border-2 border-zinc-950 bg-white/70',
                    isArtist && 'h-11',
                  )}
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password" className={cn(isArtist && 'text-sm font-medium text-foreground')}>
                    Passord
                  </FieldLabel>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={cn(
                    isPoster && 'h-11 rounded-none border-2 border-zinc-950 bg-white/70',
                    isArtist && 'h-11',
                  )}
                />
              </Field>
              <Field>
                <Button
                  type="submit"
                  size={isArtist ? 'lg' : undefined}
                  className={cn(
                    isPoster && 'h-11 w-full rounded-none border-2 border-zinc-950 bg-[#b83224] font-bold text-white shadow-[4px_4px_0_#18181b] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-[#9f2d21] hover:shadow-[2px_2px_0_#18181b]',
                    isArtist && 'h-11 w-full',
                  )}
                >
                  Logg inn
                </Button>
                {showSignupLink && (
                  <FieldDescription className={cn(
                    'text-center',
                    isPoster && 'pt-2 text-sm font-medium text-zinc-600',
                    isArtist && 'pt-2 text-sm text-muted-foreground',
                  )}>
                    Ny artist?{' '}
                    <Link
                      href={signupHref}
                      className={cn(
                        isPoster && 'font-bold underline decoration-2 underline-offset-4 hover:text-[#b83224]',
                        isArtist && 'font-semibold text-primary underline underline-offset-4 hover:text-primary/80',
                      )}
                    >
                      Registrer artistprofil
                    </Link>
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
