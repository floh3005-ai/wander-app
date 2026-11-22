import { kumuliert } from './geo'
import type { Punkt } from './typen'

/**
 * Schwierigkeit eines Wegstücks nach der SAC-Wanderskala (aus OpenStreetMap).
 * Im Punkt steht sie als vierte Zahl und gilt für das Stück, das an diesem Punkt endet:
 *   0 = keine Angabe / einfacher Weg, 1–6 = T1–T6, 7 = Klettersteig,
 *   +10 = Weg im Gelände schlecht erkennbar.
 */
export interface Stufe {
  kurz: string
  titel: string
  text: string
  farbe: string
}

const STUFEN: Record<number, Stufe> = {
  2: {
    kurz: 'T2',
    titel: 'Bergwandern',
    text: 'Trittsicherheit erforderlich. Weg teils schmal und steil.',
    farbe: '#ffd400',
  },
  3: {
    kurz: 'T3',
    titel: 'Anspruchsvolles Bergwandern',
    text: 'Gute Trittsicherheit und Schwindelfreiheit nötig. Ausgesetzte Stellen, teils mit Seilen oder Ketten gesichert.',
    farbe: '#ff8a00',
  },
  4: {
    kurz: 'T4',
    titel: 'Alpinwandern',
    text: 'Stellenweise braucht man die Hände. Alpine Erfahrung nötig, Absturzgefahr.',
    farbe: '#e00000',
  },
  5: {
    kurz: 'T5',
    titel: 'Anspruchsvolles Alpinwandern',
    text: 'Einfache Kletterstellen, oft weglos. Nur mit viel alpiner Erfahrung.',
    farbe: '#1a1a1a',
  },
  6: {
    kurz: 'T6',
    titel: 'Schwieriges Alpinwandern',
    text: 'Kletterstellen, sehr ausgesetzt, meist weglos. Nur für Könner.',
    farbe: '#1a1a1a',
  },
  7: {
    kurz: 'Klettersteig',
    titel: 'Klettersteig',
    text: 'Nur mit Klettersteig-Ausrüstung und Erfahrung.',
    farbe: '#1a1a1a',
  },
}

const SAC: Record<string, number> = {
  hiking: 1,
  mountain_hiking: 2,
  demanding_mountain_hiking: 3,
  alpine_hiking: 4,
  demanding_alpine_hiking: 5,
  difficult_alpine_hiking: 6,
}

/** Aus den Weg-Eigenschaften des Routing-Dienstes die Kennzahl bilden. */
export function stufeAusTags(tags: string): number {
  let stufe = 0
  let unklar = false
  for (const teil of tags.split(' ')) {
    const [name, wert] = teil.split('=')
    if (name === 'sac_scale') stufe = Math.max(stufe, SAC[wert] ?? 0)
    else if (name === 'highway' && wert === 'via_ferrata') stufe = 7
    else if (name === 'trail_visibility' && (wert === 'bad' || wert === 'horrible' || wert === 'no')) unklar = true
  }
  return stufe + (unklar ? 10 : 0)
}

/** Beschreibung zu einer Kennzahl – nur für Stücke, auf die man hinweisen sollte (ab T2). */
export function stufe(code: number | undefined): Stufe | null {
  if (code === undefined) return null
  return STUFEN[code % 10] ?? null
}

export function schlechtErkennbar(code: number | undefined): boolean {
  return code !== undefined && code >= 10
}

export interface Strecke {
  code: number
  /** Position im Punkte-Feld */
  von: number
  bis: number
  /** Meter ab Start */
  vonM: number
  bisM: number
}

/** Zusammenhängende Stücke gleicher Schwierigkeit. */
export function strecken(punkte: Punkt[]): Strecke[] {
  const meter = kumuliert(punkte)
  const out: Strecke[] = []
  for (let i = 1; i < punkte.length; i++) {
    const code = punkte[i][3] ?? 0
    const letzte = out[out.length - 1]
    if (letzte && letzte.code === code && letzte.bis === i - 1) {
      letzte.bis = i
      letzte.bisM = meter[i]
    } else {
      out.push({ code, von: i - 1, bis: i, vonM: meter[i - 1], bisM: meter[i] })
    }
  }
  return out
}

/** Gibt es zu diesem Weg überhaupt Angaben? (Importierte GPX-Touren haben keine.) */
export function hatAngaben(punkte: Punkt[]): boolean {
  let mit = 0
  for (const p of punkte) if (p[3] !== undefined) mit++
  return mit > punkte.length / 2
}

/** Einen Abschnitt umdrehen – die Kennzahlen wandern dabei mit ihrem Wegstück mit. */
export function umgedreht(abschnitt: Punkt[]): Punkt[] {
  const n = abschnitt.length
  return abschnitt.map((_, i) => {
    const p = abschnitt[n - 1 - i]
    const code = i === 0 ? undefined : abschnitt[n - i][3]
    // Abbiegung bleibt an derselben Stelle, wechselt aber die Seite (rechts ↔ links)
    if (p[4] !== undefined) return [p[0], p[1], p[2], code ?? 0, p[4] === 0 ? 0 : -p[4]]
    return code === undefined ? [p[0], p[1], p[2]] : [p[0], p[1], p[2], code]
  })
}
