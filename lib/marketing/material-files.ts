/**
 * Filnavn i zip-fila med showmateriellet: komikerens navn, slik klubben
 * kjenner det igjen i en mappe — «Ida Bjørnstad.jpg», ikke «a3f9…jpg».
 *
 * Tegn som ikke er lov i et filnavn på Windows eller macOS (`/ \ : * ? " < > |`)
 * fjernes; æøå blir stående. To komikere med samme navn får «(2)» etter.
 */
export function materialFileName(name: string, extension: string, used: Set<string>): string {
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim() || 'file'

  let candidate = `${base}.${extension}`
  for (let copy = 2; used.has(candidate.toLowerCase()); copy++) {
    candidate = `${base} (${copy}).${extension}`
  }
  used.add(candidate.toLowerCase())
  return candidate
}
