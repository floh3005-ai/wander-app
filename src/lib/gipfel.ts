import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { entfernung } from './geo'
import { kachelVorlage } from './orte'

export interface Gipfel {
  name: string
  hoehe?: number
  lon: number
  lat: number
  /** Entfernung vom Standort in Metern */
  meter: number
  /** Himmelsrichtung vom Standort aus in Grad (0 = Norden, 90 = Osten) */
  richtung: number
}

/** Richtung von einem Punkt zum anderen in Grad (0 = Norden, im Uhrzeigersinn). */
export function peilung(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180
  const dLon = (lon2 - lon1) * rad
  const y = Math.sin(dLon) * Math.cos(lat2 * rad)
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon)
  return ((Math.atan2(y, x) / rad) + 360) % 360
}

const RICHTUNGEN = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']

export function richtungText(grad: number): string {
  return RICHTUNGEN[Math.round((((grad % 360) + 360) % 360) / 45) % 8]
}

/** Kleinster Winkel zwischen zwei Richtungen, mit Vorzeichen (−180 … 180). */
export function winkelUnterschied(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

interface Roh {
  name: string
  hoehe?: number
  lon: number
  lat: number
}

async function ladeGipfel(url: string, z: number, x: number, y: number): Promise<Roh[]> {
  const antwort = await fetch(url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
  if (!antwort.ok) return []
  const lage = new VectorTile(new PbfReader(new Uint8Array(await antwort.arrayBuffer()))).layers.mountain_peak
  if (!lage) return []
  const out: Roh[] = []
  const n = 2 ** z
  for (let i = 0; i < lage.length; i++) {
    const f = lage.feature(i)
    const p = f.properties as Record<string, string | number | undefined>
    if (p.class !== 'peak' && p.class !== 'volcano') continue
    const name = String(p['name:de'] ?? p.name ?? '').trim()
    if (!name) continue
    const g = f.loadGeometry()[0]?.[0]
    if (!g || g.x < 0 || g.y < 0 || g.x >= lage.extent || g.y >= lage.extent) continue
    const hoehe = Number(p.ele)
    out.push({
      name,
      hoehe: Number.isFinite(hoehe) && hoehe > 0 ? hoehe : undefined,
      lon: ((x + g.x / lage.extent) / n) * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + g.y / lage.extent)) / n))) * 180) / Math.PI,
    })
  }
  return out
}

function kachel(lon: number, lat: number, z: number): [number, number] {
  const r = (lat * Math.PI) / 180
  return [
    Math.floor(((lon + 180) / 360) * 2 ** z),
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z),
  ]
}

/**
 * Benannte Gipfel rund um einen Standort: in der Nähe (bis ca. 12 km) alle,
 * weiter weg (bis ca. 45 km) nur die bedeutenden.
 */
export async function gipfelRundum(lon: number, lat: number): Promise<Gipfel[]> {
  const url = await kachelVorlage()
  const auftraege: Promise<Roh[]>[] = []
  for (const [z, rand] of [
    [12, 2],
    [10, 1],
  ]) {
    const [x0, y0] = kachel(lon, lat, z)
    for (let dx = -rand; dx <= rand; dx++) {
      for (let dy = -rand; dy <= rand; dy++) {
        auftraege.push(ladeGipfel(url, z, x0 + dx, y0 + dy).catch(() => []))
      }
    }
  }
  const alle = (await Promise.all(auftraege)).flat()

  const gesehen = new Set<string>()
  const out: Gipfel[] = []
  for (const g of alle) {
    // Derselbe Gipfel kommt aus beiden Zoomstufen – nur einmal übernehmen
    const schluessel = `${g.name}|${g.lon.toFixed(3)}|${g.lat.toFixed(3)}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    const meter = entfernung(lon, lat, g.lon, g.lat)
    if (meter < 30 || meter > 45_000) continue
    out.push({ ...g, meter, richtung: peilung(lon, lat, g.lon, g.lat) })
  }
  out.sort((a, b) => a.meter - b.meter)
  return out
}
