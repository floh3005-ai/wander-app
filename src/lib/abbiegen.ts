import { entfernung, kumuliert } from './geo'
import { peilung, winkelUnterschied } from './gipfel'
import type { Punkt } from './typen'

/**
 * Abbiegehinweise. Im Punkt steht der Abbiegewinkel als fünfte Zahl
 * (positiv = nach rechts, negativ = nach links, 0 = hier nichts, fehlt = unbekannt).
 * Bei im Planer geplanten Touren kommt er vom Routing-Dienst; bei importierten
 * Touren wird er aus dem Linienverlauf geschätzt.
 */
export interface Abbiegung {
  /** Stelle im zusammengesetzten Weg */
  index: number
  /** Meter ab Start */
  meter: number
  /** Grad: positiv rechts, negativ links */
  winkel: number
}

export interface Fuehrung {
  punkte: Punkt[]
  meter: number[]
  liste: Abbiegung[]
  /** false = Hinweise sind nur aus der Form der Linie geschätzt */
  genau: boolean
}

/** Erst ab diesem Winkel lohnt ein Hinweis */
export const MIN_WINKEL = 20

/** Richtungsänderung an einer Stelle, gemessen über ein Stück davor und danach. */
function formWinkel(punkte: Punkt[], meter: number[], i: number, fenster = 25): number {
  let a = i
  while (a > 0 && meter[i] - meter[a] < fenster) a--
  let b = i
  while (b < punkte.length - 1 && meter[b] - meter[i] < fenster) b++
  if (a === i || b === i) return 0
  const vorher = peilung(punkte[a][0], punkte[a][1], punkte[i][0], punkte[i][1])
  const nachher = peilung(punkte[i][0], punkte[i][1], punkte[b][0], punkte[b][1])
  return winkelUnterschied(nachher, vorher)
}

/** Aus den Abschnitten einer Tour den Weg samt Abbiegestellen aufbauen. */
export function fuehrungAus(abschnitte: (Punkt[] | null)[]): Fuehrung {
  const punkte: Punkt[] = []
  const naehte: number[] = []
  for (const a of abschnitte) {
    if (!a) continue
    if (punkte.length > 0) naehte.push(punkte.length - 1)
    for (let i = 0; i < a.length; i++) {
      const p = a[i]
      const letzter = punkte[punkte.length - 1]
      if (i === 0 && letzter && letzter[0] === p[0] && letzter[1] === p[1]) continue
      punkte.push(p)
    }
  }
  const meter = kumuliert(punkte)

  let mitAngabe = 0
  for (const p of punkte) if (p[4] !== undefined) mitAngabe++
  const genau = mitAngabe > punkte.length / 2

  const liste: Abbiegung[] = []
  if (genau) {
    punkte.forEach((p, index) => {
      const w = p[4]
      if (w !== undefined && Math.abs(w) >= MIN_WINKEL) liste.push({ index, meter: meter[index], winkel: w })
    })
    // An den Nahtstellen zwischen zwei Abschnitten (Deine Wegpunkte) kennt der
    // Routing-Dienst keine Abbiegung – dort aus der Form ablesen.
    for (const index of naehte) {
      const w = formWinkel(punkte, meter, index)
      if (Math.abs(w) < 40) continue
      if (liste.some((x) => Math.abs(x.meter - meter[index]) < 20)) continue
      liste.push({ index, meter: meter[index], winkel: w })
    }
    liste.sort((x, y) => x.meter - y.meter)
  } else {
    // Keine Angaben (GPX-Import, ältere Tour): deutliche Knicke im Linienverlauf suchen
    let beste: Abbiegung | null = null
    for (let index = 1; index < punkte.length - 1; index++) {
      const w = formWinkel(punkte, meter, index)
      if (Math.abs(w) >= 45) {
        if (!beste || Math.abs(w) > Math.abs(beste.winkel)) beste = { index, meter: meter[index], winkel: w }
      } else if (beste && meter[index] - beste.meter > 30) {
        liste.push(beste)
        beste = null
      }
    }
    if (beste) liste.push(beste)
  }
  return { punkte, meter, liste, genau }
}

/** Pfeil und Worte zu einem Abbiegewinkel. */
export function hinweis(winkel: number): { pfeil: string; text: string } {
  const rechts = winkel > 0
  const w = Math.abs(winkel)
  if (w >= 165) return { pfeil: '↩', text: 'umkehren' }
  if (w >= 125) return rechts ? { pfeil: '↘', text: 'scharf rechts abbiegen' } : { pfeil: '↙', text: 'scharf links abbiegen' }
  if (w >= 50) return rechts ? { pfeil: '→', text: 'rechts abbiegen' } : { pfeil: '←', text: 'links abbiegen' }
  return rechts ? { pfeil: '↗', text: 'halb rechts halten' } : { pfeil: '↖', text: 'halb links halten' }
}

/** Entfernung für die Anzeige runden: 10er-Schritte, ab 1 km in Kilometern. */
export function meterText(m: number): string {
  if (m >= 1000) return `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`
  return `${Math.max(10, Math.round(m / 10) * 10)} m`
}

/**
 * Wo auf dem Weg bin ich? Sucht zuerst in der Nähe der letzten bekannten Stelle
 * (damit die Anzeige bei Schleifen und Hin-und-zurück-Wegen nicht springt) und
 * erst dann auf dem ganzen Weg.
 */
export function stelleAufWeg(
  f: Fuehrung,
  lon: number,
  lat: number,
  zuletzt: number | null,
): { index: number; daneben: number } {
  const suche = (von: number, bis: number) => {
    let best = von
    let bestD = Infinity
    for (let i = von; i <= bis; i++) {
      const d = entfernung(f.punkte[i][0], f.punkte[i][1], lon, lat)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return { index: best, daneben: bestD }
  }
  const ende = f.punkte.length - 1
  if (zuletzt !== null) {
    let von = zuletzt
    while (von > 0 && f.meter[zuletzt] - f.meter[von] < 60) von--
    let bis = zuletzt
    while (bis < ende && f.meter[bis] - f.meter[zuletzt] < 400) bis++
    const nah = suche(von, bis)
    if (nah.daneben <= 45) return nah
  }
  return suche(0, ende)
}
