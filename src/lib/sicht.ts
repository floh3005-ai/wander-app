import type { Gelaende } from './gelaende'
import type { Gipfel } from './gipfel'

const ERDRADIUS = 6371008.8
/** Lichtstrahlen krümmen sich leicht mit der Erde – dadurch sieht man etwas weiter. */
const BRECHUNG = 0.87
/** Abstand der Abtastpunkte entlang der Sichtlinie in Metern */
const SCHRITT = 120

export interface Standpunkt {
  lon: number
  lat: number
  /** Höhe der Augen über dem Meer */
  hoehe: number
}

export function gipfelSchluessel(g: Gipfel): string {
  return `${g.name}|${g.lon.toFixed(4)}|${g.lat.toFixed(4)}`
}

/** Winkel über dem Horizont (Grad), unter dem ein Punkt in dieser Entfernung und Höhe erscheint. */
export function hoehenwinkel(von: number, bis: number, meter: number): number {
  const absenkung = ((meter * meter) / (2 * ERDRADIUS)) * BRECHUNG
  return (Math.atan2(bis - von - absenkung, meter) * 180) / Math.PI
}

/**
 * Ist ein Gipfel vom Standpunkt aus wirklich zu sehen? Das Gelände wird entlang
 * der Sichtlinie abgetastet: Ragt dazwischen etwas höher auf, ist er verdeckt.
 */
export function istSichtbar(gelaende: Gelaende, ort: Standpunkt, g: Gipfel, gipfelHoehe: number): boolean {
  const ziel = hoehenwinkel(ort.hoehe, gipfelHoehe, g.meter)
  const anzahl = Math.max(4, Math.floor(g.meter / SCHRITT))
  // Die letzten 6 % auslassen: Das ist schon der Gipfelaufbau selbst.
  for (let i = 1; i < anzahl * 0.94; i++) {
    const anteil = i / anzahl
    const h = gelaende.hoeheBei(ort.lon + (g.lon - ort.lon) * anteil, ort.lat + (g.lat - ort.lat) * anteil)
    if (!Number.isFinite(h)) continue
    // Das Höhenmodell ist grob (ca. 100 m): kleine Überstände nicht als Hindernis werten.
    if (hoehenwinkel(ort.hoehe, h, g.meter * anteil) > ziel + 0.5) return false
  }
  return true
}
