import * as maplibregl from 'maplibre-gl'
import type { Punkt } from './typen'

// Karten ohne Netz: Jede Kartenkachel, die einmal angezeigt wurde, bleibt auf dem
// Gerät. Zusätzlich lässt sich der Kartenstreifen entlang einer Tour gezielt
// herunterladen. Bewusst sparsam – die Wanderkarte ist ein kostenloser Dienst,
// ganze Regionen dürfen dort nicht abgesaugt werden.
const NEBENBEI = 'wander-karten-nebenbei-v1'
const TOUREN = 'wander-karten-touren-v1'
const MERK = 'wander.offline.v1'
export const PROTOKOLL = 'wandertopo'
const ZOOMS = [12, 13, 14, 15]
const RAND = 350 // Meter links und rechts vom Weg
const MAX_KACHELN = 600
const MAX_NEBENBEI = 4000

function adresse(z: number, x: number, y: number): string {
  // Immer derselbe Server je Kachel, damit sie im Speicher wiedergefunden wird
  return `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`
}

const hatSpeicher = typeof caches !== 'undefined'
let gemerkt = 0

async function aufraeumen(): Promise<void> {
  const lager = await caches.open(NEBENBEI)
  const alle = await lager.keys()
  if (alle.length <= MAX_NEBENBEI) return
  // Die ältesten zuerst (Reihenfolge = Reihenfolge des Speicherns)
  await Promise.all(alle.slice(0, alle.length - MAX_NEBENBEI + 500).map((k) => lager.delete(k)))
}

/** Einmal beim Start: Die Karte holt ihre Kacheln ab jetzt über den Gerätespeicher. */
export function richteOfflineKartenEin(): void {
  maplibregl.addProtocol(PROTOKOLL, async (anfrage, abbruch) => {
    const [z, x, y] = anfrage.url.replace(`${PROTOKOLL}://`, '').split('/').map(Number)
    const url = adresse(z, x, y)
    if (hatSpeicher) {
      const treffer = await caches.match(url)
      if (treffer) return { data: await treffer.arrayBuffer() }
    }
    const antwort = await fetch(url, { signal: abbruch.signal })
    if (!antwort.ok) throw new Error(`Kartenkachel nicht verfügbar (${antwort.status})`)
    if (hatSpeicher) {
      const kopie = antwort.clone()
      caches
        .open(NEBENBEI)
        .then((lager) => lager.put(url, kopie))
        .then(() => {
          gemerkt++
          if (gemerkt % 200 === 0) return aufraeumen()
        })
        .catch(() => {})
    }
    return { data: await antwort.arrayBuffer() }
  })
}

function kachelX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function kachelY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/** Alle Kacheln im Streifen entlang eines Wegs. */
export function kachelnFuerWeg(punkte: Punkt[]): string[] {
  const menge = new Set<string>()
  for (const z of ZOOMS) {
    for (const p of punkte) {
      const dLat = RAND / 111320
      const dLon = dLat / Math.cos((p[1] * Math.PI) / 180)
      for (let x = kachelX(p[0] - dLon, z); x <= kachelX(p[0] + dLon, z); x++) {
        for (let y = kachelY(p[1] + dLat, z); y <= kachelY(p[1] - dLat, z); y++) {
          menge.add(adresse(z, x, y))
        }
      }
    }
  }
  return Array.from(menge)
}

export interface OfflineStand {
  /** Für welchen Wegverlauf geladen wurde */
  kennung: string
  kacheln: number
  zeit: string
}

export function ladeOfflineStaende(): Record<string, OfflineStand> {
  try {
    return JSON.parse(localStorage.getItem(MERK) ?? '{}')
  } catch {
    return {}
  }
}

function merkeStand(tourId: string, stand: OfflineStand): void {
  const alle = ladeOfflineStaende()
  alle[tourId] = stand
  try {
    localStorage.setItem(MERK, JSON.stringify(alle))
  } catch {
    // nicht schlimm
  }
}

/**
 * Kartenstreifen einer Tour aufs Gerät laden. Meldet den Fortschritt und gibt
 * zurück, wie viele Kacheln jetzt gespeichert sind.
 */
export async function ladeKartenFuerTour(
  tourId: string,
  kennung: string,
  punkte: Punkt[],
  fortschritt: (fertig: number, gesamt: number) => void,
): Promise<number> {
  if (!hatSpeicher) throw new Error('Dieses Gerät kann keine Karten speichern.')
  const urls = kachelnFuerWeg(punkte)
  if (urls.length > MAX_KACHELN) {
    throw new Error('Die Tour ist zu lang, um die Karte am Stück zu speichern. Bitte in Etappen teilen.')
  }
  const lager = await caches.open(TOUREN)
  let fertig = 0
  let gespeichert = 0
  let naechste = 0
  async function arbeiter() {
    while (naechste < urls.length) {
      const url = urls[naechste++]
      try {
        if (await lager.match(url)) {
          gespeichert++
        } else {
          // Schon beim Ansehen gemerkt? Dann von dort übernehmen, sonst aus dem Netz holen.
          const antwort = (await caches.match(url)) ?? (await fetch(url))
          if (antwort.ok) {
            await lager.put(url, antwort)
            gespeichert++
          }
        }
      } catch {
        // einzelne Kachel fehlt – weiter
      }
      fortschritt(++fertig, urls.length)
    }
  }
  await Promise.all([arbeiter(), arbeiter(), arbeiter(), arbeiter()])
  if (gespeichert < urls.length * 0.9) {
    throw new Error('Die Karte konnte nicht vollständig geladen werden. Bitte mit gutem Netz noch einmal versuchen.')
  }
  merkeStand(tourId, { kennung, kacheln: gespeichert, zeit: new Date().toISOString() })
  return gespeichert
}
