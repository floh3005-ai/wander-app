import type { Punkt } from './typen'

const ERDRADIUS = 6371008.8

/** Entfernung zweier Koordinaten in Metern. */
export function entfernung(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * ERDRADIUS * Math.asin(Math.sqrt(a))
}

/** Aufsummierte Strecke in Metern für jeden Punkt (erster Punkt = 0). */
export function kumuliert(punkte: Punkt[]): number[] {
  const out: number[] = new Array(punkte.length)
  let summe = 0
  for (let i = 0; i < punkte.length; i++) {
    if (i > 0) {
      summe += entfernung(punkte[i - 1][0], punkte[i - 1][1], punkte[i][0], punkte[i][1])
    }
    out[i] = summe
  }
  return out
}

export interface Hoehen {
  auf: number
  ab: number
  max: number | null
  min: number | null
}

/**
 * Höhenmeter mit Schwelle: kleine Schwankungen (Datenrauschen) zählen nicht mit.
 * Dieselbe Funktion wird später für die Aufzeichnung am Handy benutzt.
 */
export function hoehenmeter(punkte: Punkt[], schwelle = 5): Hoehen {
  let auf = 0
  let ab = 0
  let max: number | null = null
  let min: number | null = null
  let bezug: number | null = null
  for (const p of punkte) {
    const h = p[2]
    if (!Number.isFinite(h)) continue
    if (max === null || h > max) max = h
    if (min === null || h < min) min = h
    if (bezug === null) {
      bezug = h
      continue
    }
    const d = h - bezug
    if (d >= schwelle) {
      auf += d
      bezug = h
    } else if (d <= -schwelle) {
      ab -= d
      bezug = h
    }
  }
  return { auf, ab, max, min }
}

/**
 * Gehzeit in Minuten nach DIN 33466:
 * 4 km/h in der Ebene, 300 Hm/h bergauf, 500 Hm/h bergab;
 * der größere Wert zählt ganz, der kleinere zur Hälfte.
 */
export function gehzeitMinuten(meter: number, auf: number, ab: number): number {
  const horizontal = meter / 4000
  const vertikal = auf / 300 + ab / 500
  const stunden = Math.max(horizontal, vertikal) + Math.min(horizontal, vertikal) / 2
  return stunden * 60
}

export function formatDauer(minuten: number): string {
  const m = Math.round(minuten)
  const h = Math.floor(m / 60)
  const rest = m % 60
  return h > 0 ? `${h} Std. ${String(rest).padStart(2, '0')} Min.` : `${rest} Min.`
}

export function formatKm(meter: number): string {
  return (meter / 1000).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

/** Index des Punkts, der einer Koordinate am nächsten liegt. */
export function naechsterIndex(punkte: Punkt[], lon: number, lat: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < punkte.length; i++) {
    const d = entfernung(punkte[i][0], punkte[i][1], lon, lat)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Alle Abschnitte zu einer durchgehenden Linie zusammensetzen (ohne doppelte Nahtpunkte). */
export function zusammensetzen(abschnitte: (Punkt[] | null)[]): Punkt[] {
  const out: Punkt[] = []
  for (const a of abschnitte) {
    if (!a) continue
    for (let i = 0; i < a.length; i++) {
      const p = a[i]
      const letzter = out[out.length - 1]
      if (i === 0 && letzter && letzter[0] === p[0] && letzter[1] === p[1]) continue
      out.push(p)
    }
  }
  return out
}
