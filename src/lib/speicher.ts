import type { Tour } from './typen'

// Stufe 1: Touren liegen im Browser dieses PCs. In Stufe 3 kommt die Cloud dazu.
const TOUREN = 'wander.touren.v1'
const AKTIV = 'wander.aktiv.v1'
const ANSICHT = 'wander.ansicht.v1'
const GELOESCHT = 'wander.geloescht.v1'

function lesen<T>(schluessel: string, ersatz: T): T {
  try {
    const roh = localStorage.getItem(schluessel)
    return roh ? (JSON.parse(roh) as T) : ersatz
  } catch {
    return ersatz
  }
}

function schreiben(schluessel: string, wert: unknown): boolean {
  try {
    localStorage.setItem(schluessel, JSON.stringify(wert))
    return true
  } catch {
    return false
  }
}

/** NaN wird in JSON zu null – nach dem Laden (Browser oder Cloud) wieder zu NaN machen. */
export function repariere(tour: Tour): Tour {
  for (const a of tour.abschnitte) {
    if (!a) continue
    for (const p of a) if (p[2] === null) p[2] = NaN
  }
  return tour
}

export function ladeTouren(): Tour[] {
  return lesen<Tour[]>(TOUREN, []).map(repariere)
}

export function speichereTouren(touren: Tour[]): boolean {
  return schreiben(TOUREN, touren)
}

export function ladeAktiveId(): string | null {
  return lesen<string | null>(AKTIV, null)
}

export function speichereAktiveId(id: string): void {
  schreiben(AKTIV, id)
}

export interface Ansicht {
  lon: number
  lat: number
  zoom: number
  basis: 'topo' | 'osm'
  wanderwege: boolean
}

export function ladeAnsicht(): Ansicht {
  return lesen<Ansicht>(ANSICHT, { lon: 10.5, lat: 49.5, zoom: 6, basis: 'topo', wanderwege: false })
}

export function speichereAnsicht(a: Ansicht): void {
  schreiben(ANSICHT, a)
}

/** Gelöschte Touren merken (Tour-ID → Zeitpunkt), damit die Cloud davon erfährt. */
export function ladeGeloeschte(): Record<string, string> {
  return lesen<Record<string, string>>(GELOESCHT, {})
}

export function speichereGeloeschte(g: Record<string, string>): void {
  schreiben(GELOESCHT, g)
}
