import { entfernung } from './geo'
import type { Ortung } from './standort'
import { neueTour, type FotoInfo, type Punkt, type Tour } from './typen'

/**
 * Eine laufende Aufzeichnung. Reine Daten – so lässt sie sich zwischenspeichern
 * (falls die App geschlossen wird) und ohne Handy testen.
 */
export interface Lauf {
  /** Start in Millisekunden */
  beginn: number
  /** Geplante Tour, der gefolgt wird – fehlt bei „frei aufzeichnen" */
  tourId?: string
  /** Aufgezeichnete Punkte: [Länge, Breite, GPS-Höhe] */
  punkte: Punkt[]
  /** Zeitpunkt je Punkt in Millisekunden */
  zeiten: number[]
  meter: number
  /** Reine Gehzeit in Millisekunden – Stehen zählt nicht mit */
  gehzeit: number
  auf: number
  ab: number
  /** Geglättete GPS-Höhe und Bezugshöhe für die Höhenmeter-Zählung */
  glatt: number | null
  bezug: number | null
  /** GPS-Höhe minus Geländehöhe. Wird einmal bestimmt, damit die Anzeige zur Karte passt. */
  versatz: number | null
  /** Letzte Standortmeldung (auch wenn sie nicht als Punkt übernommen wurde) */
  letzte: Ortung | null
  /** Unterwegs aufgenommene Fotos */
  fotos?: FotoInfo[]
  /** Von Hand pausiert */
  pausiert: boolean
  /** Nach einer Pause: nächsten Punkt ohne Strecke und Zeit ansetzen */
  neuAnsetzen: boolean
}

// Stellschrauben
const MAX_UNGENAU = 35 // schlechtere Meldungen werden verworfen (Meter)
const MIN_SCHRITT = 10 // so weit muss man sich mindestens bewegt haben (Meter)
const STILLSTAND = 0.25 // darunter meldet das Gerät „steht" (m/s)
const LUECKE = 45_000 // längere Abstände zwischen zwei Punkten gelten als Pause (ms)
const GLAETTUNG = 0.35
const HOEHEN_SCHWELLE = 6 // kleinere Höhenänderungen sind GPS-Rauschen (Meter)
/** So lange nach dem letzten Punkt gilt man noch als „in Bewegung" (ms) */
export const BEWEGT_FENSTER = 20_000

export function neuerLauf(tourId?: string, jetzt = Date.now()): Lauf {
  return {
    beginn: jetzt,
    tourId,
    punkte: [],
    zeiten: [],
    meter: 0,
    gehzeit: 0,
    auf: 0,
    ab: 0,
    glatt: null,
    bezug: null,
    versatz: null,
    letzte: null,
    pausiert: false,
    neuAnsetzen: false,
  }
}

/** Eine Standortmeldung verarbeiten. Verändert den Lauf und gibt zurück, ob ein Punkt dazukam. */
export function verarbeite(lauf: Lauf, o: Ortung): boolean {
  if (!Number.isFinite(o.lon) || !Number.isFinite(o.lat) || o.genau > MAX_UNGENAU) return false
  lauf.letzte = o
  if (lauf.pausiert) {
    lauf.neuAnsetzen = true
    return false
  }

  const n = lauf.punkte.length
  if (n > 0 && !lauf.neuAnsetzen) {
    const vor = lauf.punkte[n - 1]
    const d = entfernung(vor[0], vor[1], o.lon, o.lat)
    // Erst zählen, wenn man sich klar weiter bewegt hat als die Ortung ungenau ist.
    if (d < Math.max(MIN_SCHRITT, Math.min(o.genau, 25))) return false
    // Das Gerät sagt „steht" und der Sprung ist klein: GPS-Zittern, keine Bewegung.
    if (o.tempo !== null && o.tempo < STILLSTAND && d < 25) return false
    const dt = o.zeit - lauf.zeiten[n - 1]
    lauf.meter += d
    // Normaler Abstand: Zeit zählt voll. Lange Lücke (Pause): nur die Zeit fürs Gehen dieser Strecke.
    lauf.gehzeit += dt <= LUECKE ? Math.max(0, dt) : Math.min(dt, (d / 0.9) * 1000)
  }
  lauf.neuAnsetzen = false

  const hoehe = o.hoehe ?? NaN
  lauf.punkte.push([o.lon, o.lat, hoehe])
  lauf.zeiten.push(o.zeit)

  if (Number.isFinite(hoehe)) {
    lauf.glatt = lauf.glatt === null ? hoehe : lauf.glatt + GLAETTUNG * (hoehe - lauf.glatt)
    if (lauf.bezug === null) {
      lauf.bezug = lauf.glatt
    } else {
      const d = lauf.glatt - lauf.bezug
      if (d >= HOEHEN_SCHWELLE) {
        lauf.auf += d
        lauf.bezug = lauf.glatt
      } else if (d <= -HOEHEN_SCHWELLE) {
        lauf.ab -= d
        lauf.bezug = lauf.glatt
      }
    }
  }
  return true
}

/** Ist man gerade in Bewegung? (Sonst läuft die automatische Pause.) */
export function inBewegung(lauf: Lauf, jetzt = Date.now()): boolean {
  if (lauf.pausiert || lauf.zeiten.length === 0) return false
  return jetzt - lauf.zeiten[lauf.zeiten.length - 1] < BEWEGT_FENSTER
}

/** Gehzeit für die Anzeige: läuft sekundenweise weiter, solange man in Bewegung ist. */
export function gehzeitJetzt(lauf: Lauf, jetzt = Date.now()): number {
  if (!inBewegung(lauf, jetzt)) return lauf.gehzeit
  return lauf.gehzeit + Math.max(0, jetzt - lauf.zeiten[lauf.zeiten.length - 1])
}

/** Aktuelle Höhe über dem Meer – GPS-Höhe, um den einmal bestimmten Versatz berichtigt. */
export function hoeheJetzt(lauf: Lauf): number | null {
  if (lauf.glatt === null) return null
  return lauf.glatt - (lauf.versatz ?? 0)
}

/** Fertige Aufzeichnung als Tour speichern. */
export function alsTour(lauf: Lauf, name: string, ende = Date.now()): Tour {
  const versatz = lauf.versatz ?? 0
  const punkte: Punkt[] = lauf.punkte.map((p) => [p[0], p[1], Number.isFinite(p[2]) ? p[2] - versatz : NaN])
  const erster = punkte[0]
  const letzter = punkte[punkte.length - 1]
  return {
    ...neueTour(),
    name,
    wegpunkte: [
      { lon: erster[0], lat: erster[1] },
      { lon: letzter[0], lat: letzter[1] },
    ],
    abschnitte: [punkte],
    fotos: lauf.fotos?.length ? lauf.fotos : undefined,
    aufzeichnung: {
      beginn: new Date(lauf.beginn).toISOString(),
      ende: new Date(ende).toISOString(),
      gehzeit: Math.round(lauf.gehzeit / 1000),
      meter: Math.round(lauf.meter),
      auf: Math.round(lauf.auf),
      ab: Math.round(lauf.ab),
      geplant: lauf.tourId,
    },
  }
}

// ---------- Zwischenspeichern, damit nichts verloren geht ----------

const SCHLUESSEL = 'wander.lauf.v1'

export function merkeLauf(lauf: Lauf | null): void {
  try {
    if (lauf) localStorage.setItem(SCHLUESSEL, JSON.stringify(lauf))
    else localStorage.removeItem(SCHLUESSEL)
  } catch {
    // Speicher voll – die Aufzeichnung läuft trotzdem im Arbeitsspeicher weiter
  }
}

export function ladeLauf(): Lauf | null {
  try {
    const roh = localStorage.getItem(SCHLUESSEL)
    if (!roh) return null
    const lauf = JSON.parse(roh) as Lauf
    for (const p of lauf.punkte) if (p[2] === null) p[2] = NaN
    return lauf
  } catch {
    return null
  }
}

/** Uhr-Anzeige, z. B. 1:07:42 */
export function formatUhr(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sek = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sek).padStart(2, '0')}`
}
