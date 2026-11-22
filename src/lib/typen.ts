/**
 * Ein Punkt auf dem Weg: [Länge, Breite, Höhe in Metern, Schwierigkeit].
 * Höhe kann NaN sein, wenn unbekannt. Die Schwierigkeit (siehe schwierigkeit.ts) ist
 * freiwillig und gilt für das Wegstück, das an diesem Punkt endet.
 */
export type Punkt = [number, number, number, number?]

/** Ein von Hand gesetzter Wegpunkt. */
export interface Wegpunkt {
  lon: number
  lat: number
}

export interface Tour {
  id: string
  name: string
  wegpunkte: Wegpunkt[]
  /** abschnitte[i] verbindet wegpunkte[i] mit wegpunkte[i+1]. null = wird gerade berechnet. */
  abschnitte: (Punkt[] | null)[]
  erstellt: string
  geaendert: string
  /** Sehenswertes am Weg (wird mit der Tour gespeichert, später auch fürs Handy ohne Netz) */
  orte?: Ort[]
  /** Für welchen Wegverlauf die Orte gesucht wurden */
  orteFuer?: string
  /** Geplanter Tag und Startzeit, z. B. 2026-11-23 und 09:00 */
  start?: { datum: string; zeit: string }
  /**
   * Nur bei aufgezeichneten Wanderungen: die gemessenen Werte. Solche Touren
   * werden im Planer nicht verändert, sondern nur angesehen oder als Vorlage kopiert.
   */
  aufzeichnung?: {
    beginn: string
    ende: string
    /** reine Gehzeit in Sekunden */
    gehzeit: number
    meter: number
    auf: number
    ab: number
    /** ID der geplanten Tour, der gefolgt wurde */
    geplant?: string
  }
}

export function neueTour(): Tour {
  const jetzt = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    wegpunkte: [],
    abschnitte: [],
    erstellt: jetzt,
    geaendert: jetzt,
  }
}

export type Kategorie =
  | 'gipfel'
  | 'aussicht'
  | 'einkehr'
  | 'schutz'
  | 'burg'
  | 'wasser'
  | 'sehenswert'
  | 'praktisch'

/** Etwas Sehenswertes oder Nützliches am Weg. */
export interface Ort {
  id: string
  kat: Kategorie
  /** z. B. „Gipfel", „Berghütte", „Parkplatz" */
  art: string
  name: string
  lon: number
  lat: number
  hoehe?: number
  /** Stelle auf der Tour in Metern ab Start */
  km: number
  /** Entfernung vom Weg in Metern */
  abstand: number
}

/** Kennung des Wegverlaufs – ändert sich, sobald ein Wegpunkt anders liegt. */
export function wegKennung(tour: Tour): string {
  return tour.wegpunkte.map((w) => `${w.lon.toFixed(5)},${w.lat.toFixed(5)}`).join(';')
}
