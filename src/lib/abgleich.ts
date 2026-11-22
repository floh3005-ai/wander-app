import { repariere } from './speicher'
import type { Tour } from './typen'

/** Eine Zeile in der Cloud-Tabelle – ohne den (großen) Tour-Inhalt. */
export interface Kopf {
  id: string
  geaendert: string
  geloescht: boolean
}

export interface Zeile extends Kopf {
  name: string
  daten: Tour | null
}

/** Was die Cloud können muss. So lässt sich der Abgleich auch ohne echte Cloud testen. */
export interface Ablage {
  koepfe(): Promise<Kopf[]>
  hole(ids: string[]): Promise<{ id: string; daten: Tour | null }[]>
  schreibe(zeilen: Zeile[]): Promise<void>
}

export interface Ergebnis {
  touren: Tour[]
  /** Lösch-Vermerke, die erledigt sind und lokal vergessen werden können */
  erledigt: string[]
  hoch: number
  runter: number
}

const zeit = (s: string) => Date.parse(s)

/**
 * Lokale Touren und Cloud zusammenbringen. Regel: Pro Tour gewinnt der neuere Stand.
 * Löschen zählt wie eine Änderung – was nach dem Löschen woanders noch bearbeitet
 * wurde, bleibt erhalten.
 */
export async function abgleichen(
  ablage: Ablage,
  lokal: Tour[],
  geloeschte: Record<string, string>,
): Promise<Ergebnis> {
  const fern = new Map((await ablage.koepfe()).map((k) => [k.id, k]))
  const lokalIds = new Set(lokal.map((t) => t.id))

  const behalten: Tour[] = []
  const hochladen: Zeile[] = []
  const holen: string[] = []
  const erledigt: string[] = []

  for (const t of lokal) {
    const f = fern.get(t.id)
    if (!f) {
      hochladen.push({ id: t.id, name: t.name, daten: t, geaendert: t.geaendert, geloescht: false })
      behalten.push(t)
    } else if (zeit(f.geaendert) > zeit(t.geaendert)) {
      // Cloud ist neuer: dort gelöscht → hier auch weg, sonst neuen Stand holen
      if (!f.geloescht) holen.push(t.id)
    } else {
      if (zeit(t.geaendert) > zeit(f.geaendert) || f.geloescht) {
        hochladen.push({ id: t.id, name: t.name, daten: t, geaendert: t.geaendert, geloescht: false })
      }
      behalten.push(t)
    }
  }

  for (const [id, wann] of Object.entries(geloeschte)) {
    if (lokalIds.has(id)) {
      erledigt.push(id)
      continue
    }
    const f = fern.get(id)
    if (f && !f.geloescht && zeit(wann) >= zeit(f.geaendert)) {
      hochladen.push({ id, name: '', daten: null, geaendert: wann, geloescht: true })
    }
    // In jedem Fall erledigt: Cloud kennt die Tour nicht, hat sie schon als gelöscht
    // vermerkt, bekommt den Vermerk jetzt – oder hat einen neueren Stand, der zurückkommt.
    erledigt.push(id)
  }

  for (const f of fern.values()) {
    if (lokalIds.has(f.id) || f.geloescht) continue
    const wann = geloeschte[f.id]
    if (wann && zeit(wann) >= zeit(f.geaendert)) continue
    holen.push(f.id)
  }

  if (hochladen.length > 0) await ablage.schreibe(hochladen)

  let runter = 0
  if (holen.length > 0) {
    for (const z of await ablage.hole(holen)) {
      if (!z.daten) continue
      behalten.push(repariere(z.daten))
      runter++
    }
  }

  return { touren: behalten, erledigt, hoch: hochladen.length, runter }
}

/**
 * Ergebnis des Abgleichs in den aktuellen Stand der App einbauen. Zwischen Start
 * und Ende des Abgleichs kann weitergearbeitet worden sein – das darf nicht
 * verloren gehen.
 */
export function zusammenfuehren(jetzt: Tour[], schnappschuss: Tour[], ergebnis: Tour[]): Tour[] {
  const vorher = new Map(schnappschuss.map((t) => [t.id, t]))
  const neu = new Map(ergebnis.map((t) => [t.id, t]))
  const jetztIds = new Set(jetzt.map((t) => t.id))
  const out: Tour[] = []

  for (const t of jetzt) {
    const e = neu.get(t.id)
    const v = vorher.get(t.id)
    if (e) {
      out.push(t.geaendert >= e.geaendert ? t : e)
    } else if (v) {
      // In der Cloud gelöscht – außer, hier wurde währenddessen weitergearbeitet
      if (t.geaendert > v.geaendert) out.push(t)
    } else {
      out.push(t) // neu angelegt oder noch leer
    }
  }
  for (const e of ergebnis) {
    // Neu aus der Cloud. (War sie im Schnappschuss, wurde sie hier gerade gelöscht.)
    if (!jetztIds.has(e.id) && !vorher.has(e.id)) out.push(e)
  }

  const gleich = out.length === jetzt.length && out.every((t, i) => t === jetzt[i])
  return gleich ? jetzt : out
}
