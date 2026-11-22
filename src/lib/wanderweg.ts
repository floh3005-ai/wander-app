import { entfernung } from './geo'
import { hoehenErgaenzen } from './hoehe'
import type { Punkt, Wegpunkt } from './typen'
import { ladeRoute, routenImAusschnitt, type Route } from './vorlagen'

/** So nah muss ein Klick an einem markierten Wanderweg liegen (Meter) */
const NAH = 45

const gemerkt = new Map<number, Promise<Route>>()

function hole(id: number): Promise<Route> {
  let r = gemerkt.get(id)
  if (!r) {
    r = ladeRoute(id)
    r.catch(() => gemerkt.delete(id))
    gemerkt.set(id, r)
  }
  return r
}

function naechste(linie: [number, number][], w: Wegpunkt): { i: number; meter: number } {
  let i = 0
  let meter = Infinity
  for (let k = 0; k < linie.length; k++) {
    const d = entfernung(linie[k][0], linie[k][1], w.lon, w.lat)
    if (d < meter) {
      meter = d
      i = k
    }
  }
  return { i, meter }
}

function laenge(linie: [number, number][]): number {
  let m = 0
  for (let i = 1; i < linie.length; i++) m += entfernung(linie[i - 1][0], linie[i - 1][1], linie[i][0], linie[i][1])
  return m
}

/** Wie weit liegt das Ende eines berechneten Wegs vom angeklickten Punkt weg? (Meter) */
export function daneben(weg: Punkt[], a: Wegpunkt, b: Wegpunkt): number {
  const s = weg[0]
  const e = weg[weg.length - 1]
  return Math.max(entfernung(s[0], s[1], a.lon, a.lat), entfernung(e[0], e[1], b.lon, b.lat))
}

/**
 * Verbindung zweier Punkte entlang eines markierten Wanderwegs (Waymarked Trails).
 * Für Wege, die auf der Karte eingezeichnet sind, die der Routenplaner aber nicht
 * kennt (z. B. Steige und Klettersteige). Liefert null, wenn kein markierter Weg
 * an beiden Punkten vorbeiführt.
 */
export async function amWanderweg(a: Wegpunkt, b: Wegpunkt): Promise<{ punkte: Punkt[]; meter: number; name: string } | null> {
  const rand = 0.0015
  const rahmen: [number, number, number, number] = [
    Math.min(a.lon, b.lon) - rand,
    Math.min(a.lat, b.lat) - rand,
    Math.max(a.lon, b.lon) + rand,
    Math.max(a.lat, b.lat) + rand,
  ]
  const liste = (await routenImAusschnitt(rahmen)).slice(0, 10)
  const routen = await Promise.all(liste.map((r) => hole(r.id).catch(() => null)))

  let beste: { linie: [number, number][]; meter: number; name: string } | null = null
  for (const r of routen) {
    if (!r) continue
    const von = naechste(r.linie, a)
    const bis = naechste(r.linie, b)
    if (von.meter > NAH || bis.meter > NAH || von.i === bis.i) continue
    const teil =
      von.i < bis.i ? r.linie.slice(von.i, bis.i + 1) : r.linie.slice(bis.i, von.i + 1).reverse()
    const meter = laenge(teil)
    if (!beste || meter < beste.meter) beste = { linie: teil, meter, name: r.name }
  }
  if (!beste) return null

  const roh = beste.linie.map(([lon, lat]) => [lon, lat, NaN, 0, 0] as Punkt)
  const punkte = await hoehenErgaenzen(roh).catch(() => roh)
  return { punkte, meter: beste.meter, name: beste.name }
}
