import { headers } from 'next/headers'

export async function getRequestPathname() {
  const headerStore = await headers()
  const rawPathname =
    headerStore.get('x-tickethalo-pathname')
    ?? headerStore.get('x-tickethalo-visible-pathname')
    ?? headerStore.get('x-matched-path')
    ?? headerStore.get('next-url')
    ?? '/'

  return normalizePathname(rawPathname)
}

function normalizePathname(value: string) {
  if (!value) return '/'

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return new URL(value).pathname || '/'
    }
  } catch {
    return '/'
  }

  const [path] = value.split('?')
  return path || '/'
}
