import { stufeAusTags } from './schwierigkeit'
import type { Punkt, Wegpunkt } from './typen'

const BROUTER = 'https://brouter.de/brouter'
const PROFIL = 'hiking-mountain'

/** Weg zwischen zwei Punkten am Wegenetz (OpenStreetMap) berechnen, mit Höhen. */
export async function route(a: Wegpunkt, b: Wegpunkt, signal?: AbortSignal): Promise<Punkt[]> {
  const normal = await routeUeber([a, b], signal)
  // Der Planer meidet schwere Steige und läuft dafür Umwege. Wird es trotzdem
  // schwierig (ab T3), bringt der Umweg nichts: dann den direkten Weg nehmen –
  // aber nur, wenn er nicht schwerer ist als der Umweg und spürbar kürzer.
  const schwer = hoechsteStufe(normal)
  if (schwer < 3) return normal
  try {
    const direkt = await routeUeber([a, b], signal, true)
    if (hoechsteStufe(direkt) <= schwer && laenge(direkt) < laenge(normal) * 0.9) return direkt
  } catch {
    // dann bleibt es beim normalen Ergebnis
  }
  return normal
}

function hoechsteStufe(weg: Punkt[]): number {
  let max = 0
  for (const p of weg) max = Math.max(max, (p[3] ?? 0) % 10)
  return max
}

function laenge(weg: Punkt[]): number {
  const rad = Math.PI / 180
  let m = 0
  for (let i = 1; i < weg.length; i++) {
    const dx = (weg[i][0] - weg[i - 1][0]) * 111320 * Math.cos(weg[i][1] * rad)
    const dy = (weg[i][1] - weg[i - 1][1]) * 110540
    m += Math.hypot(dx, dy)
  }
  return m
}

/** Weg über mehrere Punkte in der angegebenen Reihenfolge. */
/**
 * @param direkt schwere Steige nicht meiden, sondern wie jeden anderen Weg behandeln
 */
export async function routeUeber(punkte: Wegpunkt[], signal?: AbortSignal, direkt = false): Promise<Punkt[]> {
  const lonlats = punkte.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join("|")
  // SAC_scale_limit=6: Ohne diese Angabe sperrt das Profil alle Wege ab T4 (Alpinwandern), dann
  // fehlen Steige wie über die Brettgabel. Leichte Wege bleiben bevorzugt, die App zeigt die Schwierigkeit.
  const url = `${BROUTER}?lonlats=${lonlats}&profile=${PROFIL}&alternativeidx=0&format=geojson&timode=2&profile:SAC_scale_limit=6${direkt ? '&profile:SAC_scale_preferred=6' : ''}`
  const antwort = await fetch(url, { signal })
  if (!antwort.ok) {
    const text = (await antwort.text()).trim()
    throw new Error(text || `Routing-Dienst antwortet nicht (${antwort.status})`)
  }
  const daten = await antwort.json()
  const koordinaten: number[][] | undefined = daten?.features?.[0]?.geometry?.coordinates
  if (!koordinaten || koordinaten.length < 2) {
    throw new Error('Kein Weg gefunden')
  }
  const weg = koordinaten.map((k) => [k[0], k[1], k.length > 2 ? k[2] : NaN, 0, 0] as Punkt)

  // Abbiegestellen: [Stelle im Weg, Art, Ausfahrt, Meter bis zur nächsten, Winkel]
  const abbiegen: number[][] | undefined = daten?.features?.[0]?.properties?.voicehints
  for (const a of abbiegen ?? []) {
    const stelle = weg[a[0]]
    const winkel = a[4]
    if (stelle && typeof winkel === 'number' && Math.abs(winkel) >= 20) stelle[4] = winkel
  }

  // Der Dienst liefert zu jedem Wegstück die Eigenschaften des Wegs mit –
  // daraus wird die Schwierigkeit (SAC-Skala) je Punkt abgelesen.
  const zeilen: string[][] | undefined = daten?.features?.[0]?.properties?.messages
  if (zeilen && zeilen.length > 1) {
    const iLon = zeilen[0].indexOf('Longitude')
    const iLat = zeilen[0].indexOf('Latitude')
    const iTags = zeilen[0].indexOf('WayTags')
    if (iLon >= 0 && iLat >= 0 && iTags >= 0) {
      let pos = 0
      for (const zeile of zeilen.slice(1)) {
        const lon = Number(zeile[iLon])
        const lat = Number(zeile[iLat])
        for (let k = pos; k < weg.length; k++) {
          if (Math.round(weg[k][0] * 1e6) === lon && Math.round(weg[k][1] * 1e6) === lat) {
            const code = stufeAusTags(zeile[iTags] ?? '')
            for (let i = pos + 1; i <= k; i++) weg[i][3] = code
            pos = k
            break
          }
        }
      }
    }
  }
  return weg
}

/**
 * Freihand-Stück: gerade Linie zwischen zwei Punkten, alle rund 20 m ein Punkt,
 * damit Höhen und Höhenprofil nachgetragen werden können.
 */
export function freihandLinie(a: Wegpunkt, b: Wegpunkt): Punkt[] {
  const rad = Math.PI / 180
  const dx = (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * rad)
  const dy = (b.lat - a.lat) * 110540
  const teile = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 20))
  const out: Punkt[] = []
  for (let i = 0; i <= teile; i++) {
    const t = i / teile
    out.push([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t, NaN, 0, 0])
  }
  return out
}

/** Luftlinie als Notlösung, wenn kein Weg gefunden wird. */
export function luftlinie(a: Wegpunkt, b: Wegpunkt): Punkt[] {
  return [
    [a.lon, a.lat, NaN],
    [b.lon, b.lat, NaN],
  ]
}
