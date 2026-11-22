import { kumuliert } from './geo'
import type { Punkt } from './typen'

// Geländehöhen von Open-Meteo (kostenlos, ohne Konto, Geländemodell mit ca. 90 m Raster).
const DIENST = 'https://api.open-meteo.com/v1/elevation'

/** Fehlen in einem Weg die Höhen? (z. B. bei Wanderrouten-Vorlagen oder manchen GPX-Dateien) */
export function hoehenFehlen(punkte: Punkt[]): boolean {
  let ohne = 0
  for (const p of punkte) if (!Number.isFinite(p[2])) ohne++
  return ohne > punkte.length / 2
}

/**
 * Höhen für einen Weg nachtragen. Es wird nur etwa alle 40 m (bei langen Wegen
 * seltener) eine Höhe abgefragt, dazwischen wird gleichmäßig aufgefüllt.
 */
export async function hoehenErgaenzen(punkte: Punkt[]): Promise<Punkt[]> {
  if (punkte.length === 0) return punkte
  const strecke = kumuliert(punkte)
  const gesamt = strecke[strecke.length - 1]
  const schritt = Math.max(40, gesamt / 600)

  const stuetzen: number[] = [0]
  let naechste = schritt
  for (let i = 1; i < punkte.length - 1; i++) {
    if (strecke[i] >= naechste) {
      stuetzen.push(i)
      naechste = strecke[i] + schritt
    }
  }
  if (punkte.length > 1) stuetzen.push(punkte.length - 1)

  const hoehen: number[] = []
  for (let i = 0; i < stuetzen.length; i += 100) {
    const teil = stuetzen.slice(i, i + 100)
    const lat = teil.map((k) => punkte[k][1].toFixed(5)).join(',')
    const lon = teil.map((k) => punkte[k][0].toFixed(5)).join(',')
    const antwort = await fetch(`${DIENST}?latitude=${lat}&longitude=${lon}`)
    if (!antwort.ok) throw new Error('Der Höhendienst ist gerade nicht erreichbar.')
    const daten = await antwort.json()
    hoehen.push(...(daten.elevation as number[]))
  }

  // Das Geländemodell ist grob (90 m). Am Hang springt es von Punkt zu Punkt –
  // deshalb über fünf Nachbarwerte glätten, sonst kommen viel zu viele Höhenmeter heraus.
  const roh = hoehen.slice()
  for (let i = 0; i < roh.length; i++) {
    let summe = 0
    let n = 0
    for (let k = Math.max(0, i - 2); k <= Math.min(roh.length - 1, i + 2); k++) {
      summe += roh[k]
      n++
    }
    hoehen[i] = summe / n
  }

  const out: Punkt[] = punkte.map((p) => p.slice() as Punkt)
  for (let s = 0; s < stuetzen.length; s++) {
    const a = stuetzen[s]
    out[a][2] = hoehen[s]
    if (s === stuetzen.length - 1) break
    const b = stuetzen[s + 1]
    const spanne = strecke[b] - strecke[a]
    for (let i = a + 1; i < b; i++) {
      const anteil = spanne > 0 ? (strecke[i] - strecke[a]) / spanne : 0
      out[i][2] = hoehen[s] + (hoehen[s + 1] - hoehen[s]) * anteil
    }
  }
  return out
}
