import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { kumuliert } from './geo'
import type { Kategorie, Ort, Punkt } from './typen'

// Quelle: OpenFreeMap (kostenlos, ohne Konto) – Kartendaten aus OpenStreetMap.
// Dieselbe Quelle liefert später die Gipfel für den Gipfel-Finder.
const TILEJSON = 'https://tiles.openfreemap.org/planet'
const ZOOM = 14
const MAX_KACHELN = 160

export const KATEGORIEN: { kat: Kategorie; titel: string; zeichen: string }[] = [
  { kat: 'gipfel', titel: 'Gipfel', zeichen: '⛰️' },
  { kat: 'aussicht', titel: 'Aussicht', zeichen: '🔭' },
  { kat: 'einkehr', titel: 'Einkehr', zeichen: '🍴' },
  { kat: 'schutz', titel: 'Schutzhütte', zeichen: '🛖' },
  { kat: 'burg', titel: 'Burg & Ruine', zeichen: '🏰' },
  { kat: 'sehenswert', titel: 'Sehenswertes', zeichen: '⭐' },
  { kat: 'wasser', titel: 'Trinkwasser', zeichen: '🚰' },
  { kat: 'praktisch', titel: 'Parken & WC', zeichen: '🅿️' },
]

export function zeichenFuer(kat: Kategorie): string {
  return KATEGORIEN.find((k) => k.kat === kat)?.zeichen ?? '•'
}

interface Fund {
  kat: Kategorie
  art: string
  /** Name, falls der Ort keinen eigenen hat. null = ohne Namen weglassen */
  ersatz: string | null
  maxAbstand: number
}

function einordnen(ebene: string, klasse: string, unterklasse: string): Fund | null {
  if (ebene === 'mountain_peak') {
    if (klasse === 'peak' || klasse === 'volcano') {
      return { kat: 'gipfel', art: 'Gipfel', ersatz: null, maxAbstand: 600 }
    }
    return null
  }
  switch (unterklasse) {
    case 'viewpoint':
      return { kat: 'aussicht', art: 'Aussichtspunkt', ersatz: 'Aussichtspunkt', maxAbstand: 300 }
    case 'alpine_hut':
      return { kat: 'einkehr', art: 'Berghütte', ersatz: 'Berghütte', maxAbstand: 300 }
    case 'restaurant':
      return { kat: 'einkehr', art: 'Gasthaus', ersatz: null, maxAbstand: 250 }
    case 'cafe':
      return { kat: 'einkehr', art: 'Café', ersatz: null, maxAbstand: 250 }
    case 'biergarten':
      return { kat: 'einkehr', art: 'Biergarten', ersatz: 'Biergarten', maxAbstand: 250 }
    case 'pub':
      return { kat: 'einkehr', art: 'Wirtshaus', ersatz: null, maxAbstand: 250 }
    case 'wilderness_hut':
    case 'shelter':
      return { kat: 'schutz', art: 'Schutzhütte', ersatz: 'Schutzhütte', maxAbstand: 300 }
    case 'castle':
      return { kat: 'burg', art: 'Burg / Schloss', ersatz: null, maxAbstand: 400 }
    case 'ruins':
      return { kat: 'burg', art: 'Ruine', ersatz: 'Ruine', maxAbstand: 400 }
    case 'archaeological_site':
      return { kat: 'burg', art: 'Ausgrabung', ersatz: null, maxAbstand: 300 }
    case 'attraction':
      return { kat: 'sehenswert', art: 'Sehenswürdigkeit', ersatz: null, maxAbstand: 300 }
    case 'museum':
      return { kat: 'sehenswert', art: 'Museum', ersatz: null, maxAbstand: 250 }
    case 'monument':
      return { kat: 'sehenswert', art: 'Denkmal', ersatz: null, maxAbstand: 250 }
    case 'drinking_water':
      return { kat: 'wasser', art: 'Trinkwasser', ersatz: 'Trinkwasser', maxAbstand: 200 }
    case 'parking':
      return { kat: 'praktisch', art: 'Parkplatz', ersatz: 'Parkplatz', maxAbstand: 300 }
    case 'toilets':
      return { kat: 'praktisch', art: 'WC', ersatz: 'WC', maxAbstand: 200 }
  }
  if (klasse === 'castle') return { kat: 'burg', art: 'Burg / Schloss', ersatz: null, maxAbstand: 400 }
  return null
}

function kachelX(lon: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** ZOOM)
}

function kachelY(lat: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM)
}

let vorlage: Promise<string> | null = null

function kachelVorlage(): Promise<string> {
  if (!vorlage) {
    vorlage = fetch(TILEJSON)
      .then((r) => {
        if (!r.ok) throw new Error('Kartendaten nicht erreichbar')
        return r.json()
      })
      .then((j) => j.tiles[0] as string)
      .catch((e) => {
        vorlage = null
        throw e
      })
  }
  return vorlage
}

interface Roh {
  fund: Fund
  name: string
  lon: number
  lat: number
  hoehe?: number
}

async function ladeKachel(url: string, x: number, y: number): Promise<Roh[]> {
  const antwort = await fetch(url.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)))
  if (antwort.status === 204 || antwort.status === 404) return []
  if (!antwort.ok) throw new Error('Kartendaten nicht erreichbar')
  const kachel = new VectorTile(new PbfReader(new Uint8Array(await antwort.arrayBuffer())))
  const out: Roh[] = []
  for (const ebene of ['poi', 'mountain_peak']) {
    const lage = kachel.layers[ebene]
    if (!lage) continue
    for (let i = 0; i < lage.length; i++) {
      const f = lage.feature(i)
      const p = f.properties as Record<string, string | number | undefined>
      const fund = einordnen(ebene, String(p.class ?? ''), String(p.subclass ?? ''))
      if (!fund) continue
      const name = String(p['name:de'] ?? p.name ?? '').trim() || fund.ersatz
      if (!name) continue
      const punkt = f.loadGeometry()[0]?.[0]
      // Punkte im Kachelrand kommen in der Nachbarkachel noch einmal – hier weglassen.
      if (!punkt || punkt.x < 0 || punkt.y < 0 || punkt.x >= lage.extent || punkt.y >= lage.extent) continue
      const n = 2 ** ZOOM
      const lon = ((x + punkt.x / lage.extent) / n) * 360 - 180
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + punkt.y / lage.extent)) / n))) * 180) / Math.PI
      const hoehe = Number(p.ele)
      out.push({ fund, name, lon, lat, hoehe: Number.isFinite(hoehe) && hoehe > 0 ? hoehe : undefined })
    }
  }
  return out
}

/** Sehenswertes und Nützliches entlang eines Wegs suchen. */
export async function sucheAmWeg(punkte: Punkt[]): Promise<Ort[]> {
  if (punkte.length < 2) return []

  // Welche Kartenkacheln berührt der Weg (mit etwas Rand)?
  const kacheln = new Set<string>()
  for (const p of punkte) {
    const dLat = 0.0055
    const dLon = dLat / Math.cos((p[1] * Math.PI) / 180)
    for (const [ox, oy] of [
      [0, 0],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      kacheln.add(`${kachelX(p[0] + ox * dLon)}/${kachelY(p[1] + oy * dLat)}`)
    }
  }
  if (kacheln.size > MAX_KACHELN) {
    throw new Error('Die Tour ist für die Suche zu lang. Bitte in kürzere Etappen teilen.')
  }

  const url = await kachelVorlage()
  const liste = Array.from(kacheln)
  const roh: Roh[] = []
  for (let i = 0; i < liste.length; i += 8) {
    const teil = await Promise.all(
      liste.slice(i, i + 8).map((k) => {
        const [x, y] = k.split('/').map(Number)
        return ladeKachel(url, x, y)
      }),
    )
    for (const t of teil) roh.push(...t)
  }

  // Abstand zum Weg und Stelle auf der Tour bestimmen
  const strecke = kumuliert(punkte)
  const proGradLat = 111320
  const gefunden: Ort[] = []
  const gesehen = new Set<string>()
  for (const r of roh) {
    const proGradLon = proGradLat * Math.cos((r.lat * Math.PI) / 180)
    let best = Infinity
    let bestI = 0
    for (let i = 0; i < punkte.length; i++) {
      const dx = (punkte[i][0] - r.lon) * proGradLon
      const dy = (punkte[i][1] - r.lat) * proGradLat
      const d = dx * dx + dy * dy
      if (d < best) {
        best = d
        bestI = i
      }
    }
    const abstand = Math.sqrt(best)
    if (abstand > r.fund.maxAbstand) continue
    // Dasselbe mehrfach in den Daten (z. B. Parkplatz-Teilflächen): nur einmal je 150 m zeigen
    const schluessel = `${r.fund.kat}|${r.name}|${Math.round(strecke[bestI] / 150)}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    gefunden.push({
      id: `${r.fund.kat}:${r.lon.toFixed(5)},${r.lat.toFixed(5)}`,
      kat: r.fund.kat,
      art: r.fund.art,
      name: r.name,
      lon: r.lon,
      lat: r.lat,
      hoehe: r.hoehe,
      km: strecke[bestI],
      abstand,
    })
  }
  gefunden.sort((a, b) => a.km - b.km)
  return gefunden
}
