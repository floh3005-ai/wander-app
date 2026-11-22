import { kumuliert, zusammensetzen } from './geo'
import { neueTour, type Punkt, type Tour, type Wegpunkt } from './typen'

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function alsGpx(tour: Tour): string {
  const name = xml(tour.name || 'Wandertour')
  const punkte = zusammensetzen(tour.abschnitte)
  const zeilen = punkte.map((p) => {
    const ele = Number.isFinite(p[2]) ? `<ele>${p[2].toFixed(1)}</ele>` : ''
    return `      <trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}">${ele}</trkpt>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Wander-App" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${name}</name></metadata>`,
    '  <trk>',
    `    <name>${name}</name>`,
    '    <trkseg>',
    ...zeilen,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n')
}

/**
 * GPX-Datei einlesen. Der Weg bleibt genau so, wie er in der Datei steht;
 * er wird nur in Abschnitte mit Wegpunkten geteilt, damit man ihn danach
 * Stück für Stück anpassen kann.
 */
export function ausGpx(text: string, dateiname: string): Tour {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Die Datei ist keine gültige GPX-Datei.')
  }
  let knoten = Array.from(doc.getElementsByTagName('trkpt'))
  if (knoten.length < 2) knoten = Array.from(doc.getElementsByTagName('rtept'))
  if (knoten.length < 2) {
    throw new Error('In der GPX-Datei ist kein Weg enthalten.')
  }
  const punkte: Punkt[] = []
  for (const k of knoten) {
    const lat = Number(k.getAttribute('lat'))
    const lon = Number(k.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const eleText = k.getElementsByTagName('ele')[0]?.textContent
    const ele = eleText ? Number(eleText) : NaN
    punkte.push([lon, lat, ele])
  }
  if (punkte.length < 2) {
    throw new Error('In der GPX-Datei ist kein Weg enthalten.')
  }

  const name =
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('rte > name')?.textContent?.trim() ||
    dateiname.replace(/\.gpx$/i, '')

  return ausPunkten(name, punkte)
}

/**
 * Aus einem fertigen Wegverlauf eine Tour machen: Der Weg bleibt unverändert,
 * bekommt aber alle 1,5 km (bei langen Touren seltener) einen Wegpunkt zum Anpassen.
 */
export function ausPunkten(name: string, punkte: Punkt[]): Tour {
  const strecke = kumuliert(punkte)
  const gesamt = strecke[strecke.length - 1]
  const abstand = Math.max(1500, gesamt / 25)

  const schnitte: number[] = [0]
  let naechste = abstand
  for (let i = 1; i < punkte.length - 1; i++) {
    if (strecke[i] >= naechste && gesamt - strecke[i] > abstand / 2) {
      schnitte.push(i)
      naechste = strecke[i] + abstand
    }
  }
  schnitte.push(punkte.length - 1)

  const wegpunkte: Wegpunkt[] = schnitte.map((i) => ({ lon: punkte[i][0], lat: punkte[i][1] }))
  const abschnitte: Punkt[][] = []
  for (let s = 0; s < schnitte.length - 1; s++) {
    abschnitte.push(punkte.slice(schnitte[s], schnitte[s + 1] + 1))
  }

  return { ...neueTour(), name, wegpunkte, abschnitte }
}

export function herunterladen(dateiname: string, inhalt: string): void {
  const blob = new Blob([inhalt], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function dateiname(tour: Tour): string {
  const basis = (tour.name || 'wandertour')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  return `${basis || 'wandertour'}.gpx`
}
