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

/** Persönliches Tempo für die Zeitplanung – gemütlich, mit Stehenbleiben und Gucken. */
export interface Tempo {
  /** Kilometer pro Stunde in der Ebene */
  kmh: number
  /** Höhenmeter pro Stunde bergauf */
  auf: number
  /** Höhenmeter pro Stunde bergab */
  ab: number
}

/** Anne-Katrins Tempo (22.11.2026): 2,8 km/h, 200 Hm/h bergauf, 300 Hm/h bergab – mit Hund und kurzen Stopps. */
export const MEIN_TEMPO: Tempo = { kmh: 2.8, auf: 200, ab: 300 }
/** Übliche Wanderer-Norm (DIN 33466), reine Gehzeit ohne Pausen */
export const NORM_TEMPO: Tempo = { kmh: 4, auf: 300, ab: 500 }

const TEMPO_MERK = 'wander.tempo.v2'

function ladeTempo(): Tempo {
  try {
    const t = JSON.parse(localStorage.getItem(TEMPO_MERK) ?? 'null')
    if (t && t.kmh > 0 && t.auf > 0 && t.ab > 0) return t
  } catch {
    // Standard nehmen
  }
  return MEIN_TEMPO
}

let tempo: Tempo = ladeTempo()

export function aktuellesTempo(): Tempo {
  return tempo
}

export function setzeTempo(neu: Tempo): void {
  tempo = neu
  try {
    localStorage.setItem(TEMPO_MERK, JSON.stringify(neu))
  } catch {
    // gilt dann nur bis zum Schließen
  }
}

/**
 * Geplante Zeit in Minuten. Rechenweg wie in der Wanderer-Norm (DIN 33466), aber
 * mit dem persönlichen Tempo: Strecke und Höhenmeter werden getrennt in Stunden
 * umgerechnet; der größere Wert zählt ganz, der kleinere zur Hälfte.
 */
export function gehzeitMinuten(meter: number, auf: number, ab: number): number {
  const horizontal = meter / (tempo.kmh * 1000)
  const vertikal = auf / tempo.auf + ab / tempo.ab
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

/** Länge der Wegstücke, die für die Zeitplanung einzeln betrachtet werden (Meter) */
const STUECK = 250

/**
 * Geplante Zeit für einen Weg in Minuten – stückweise gerechnet.
 * Der Weg wird in kurze Stücke zerlegt. Für jedes Stück zählt der langsamere
 * der beiden Werte: die Zeit nach der Strecke oder die Zeit nach den Höhenmetern.
 * So kosten nur wirklich steile Stücke extra Zeit; sanftes Auf und Ab fällt
 * nicht ins Gewicht. Die Grenze ergibt sich aus dem Tempo selbst (bei 2,8 km/h
 * und 200 Hm/h bergauf: ab etwa 7 % Steigung).
 */
export function zeitFuerWeg(punkte: Punkt[], eigenes?: Tempo): number {
  const t = eigenes && eigenes.kmh > 0 && eigenes.auf > 0 && eigenes.ab > 0 ? eigenes : tempo
  if (punkte.length < 2) return 0
  const strecke = kumuliert(punkte)

  // Aufsummierte Höhenmeter je Punkt – gleiche Zählweise wie bei „Bergauf/Bergab"
  const auf: number[] = new Array(punkte.length).fill(0)
  const ab: number[] = new Array(punkte.length).fill(0)
  let bezug: number | null = null
  let sAuf = 0
  let sAb = 0
  for (let i = 0; i < punkte.length; i++) {
    const h = punkte[i][2]
    if (Number.isFinite(h)) {
      if (bezug === null) bezug = h
      else if (h - bezug >= 5) {
        sAuf += h - bezug
        bezug = h
      } else if (h - bezug <= -5) {
        sAb += bezug - h
        bezug = h
      }
    }
    auf[i] = sAuf
    ab[i] = sAb
  }

  let stunden = 0
  let von = 0
  for (let i = 1; i < punkte.length; i++) {
    const letzter = i === punkte.length - 1
    if (strecke[i] - strecke[von] < STUECK && !letzter) continue
    const eben = (strecke[i] - strecke[von]) / (t.kmh * 1000)
    const steil = (auf[i] - auf[von]) / t.auf + (ab[i] - ab[von]) / t.ab
    stunden += Math.max(eben, steil)
    von = i
  }
  return stunden * 60
}
