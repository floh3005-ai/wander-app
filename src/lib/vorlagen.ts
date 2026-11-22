import { routeUeber } from './brouter'
import { entfernung, kumuliert } from './geo'
import { ausPunkten } from './gpx'
import { hoehenErgaenzen } from './hoehe'
import type { Punkt, Tour, Wegpunkt } from './typen'

// Ausgeschilderte Wanderrouten von Waymarked Trails (Daten: OpenStreetMap).
const DIENST = 'https://hiking.waymarkedtrails.org/api/v1'

export interface RoutenInfo {
  id: number
  name: string
  kuerzel?: string
  /** international · national · regional · lokal */
  ebene: string
}

export interface Route {
  id: number
  name: string
  /** [Länge, Breite] in der Reihenfolge des Wegs */
  linie: [number, number][]
  meter: number
  /** true, wenn die Route Lücken oder Abzweigungen hat und nur der längste Teil übernommen wurde */
  unvollstaendig: boolean
}

const EBENEN: Record<string, string> = {
  INT: 'international',
  NAT: 'national',
  REG: 'regional',
  LOC: 'lokal',
}

const R = 20037508.34

function nachMercator(lon: number, lat: number): [number, number] {
  const x = (lon * R) / 180
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180)
  return [x, y]
}

function vonMercator(x: number, y: number): [number, number] {
  const lon = (x / R) * 180
  const lat = (Math.atan(Math.exp((y / R) * Math.PI)) * 360) / Math.PI - 90
  return [lon, lat]
}

/** Wanderrouten im Kartenausschnitt [west, süd, ost, nord]. */
export async function routenImAusschnitt(rahmen: [number, number, number, number]): Promise<RoutenInfo[]> {
  const a = nachMercator(rahmen[0], rahmen[1])
  const b = nachMercator(rahmen[2], rahmen[3])
  const bbox = [a[0], a[1], b[0], b[1]].map((v) => v.toFixed(0)).join(',')
  const antwort = await fetch(`${DIENST}/list/by_area?bbox=${bbox}&limit=40`)
  if (!antwort.ok) throw new Error('Die Wanderrouten sind gerade nicht erreichbar.')
  const daten = await antwort.json()
  const reihenfolge = ['LOC', 'REG', 'NAT', 'INT']
  return (daten.results ?? [])
    .filter((r: any) => r.type === 'relation' && (r.name || r.ref))
    .sort((x: any, y: any) => reihenfolge.indexOf(x.group) - reihenfolge.indexOf(y.group))
    .map((r: any) => ({
      id: r.id,
      name: r.name || `Weg ${r.ref}`,
      kuerzel: r.ref,
      ebene: EBENEN[r.group] ?? '',
    }))
}

/** Alle Wegstücke einer Route in der gelieferten Reihenfolge einsammeln. */
function sammle(knoten: any, stuecke: [number, number][][]): void {
  if (!knoten || typeof knoten !== 'object') return
  if (Array.isArray(knoten)) {
    for (const k of knoten) sammle(k, stuecke)
    return
  }
  const g = knoten.geometry
  if (g?.type === 'LineString' && Array.isArray(g.coordinates)) {
    stuecke.push(g.coordinates.map((c: number[]) => vonMercator(c[0], c[1])))
    return
  }
  if (g?.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    for (const teil of g.coordinates) {
      stuecke.push(teil.map((c: number[]) => vonMercator(c[0], c[1])))
    }
    return
  }
  for (const schluessel of Object.keys(knoten)) {
    // Rückwege und Abzweigungen auslassen – die Hauptrichtung reicht als Vorlage.
    if (schluessel === 'backward' || schluessel === 'appendices' || schluessel === 'tags') continue
    const wert = knoten[schluessel]
    if (wert && typeof wert === 'object') sammle(wert, stuecke)
  }
}

function abstand(a: [number, number], b: [number, number]): number {
  return entfernung(a[0], a[1], b[0], b[1])
}

function laenge(linie: [number, number][]): number {
  let m = 0
  for (let i = 1; i < linie.length; i++) m += abstand(linie[i - 1], linie[i])
  return m
}

/** Wegverlauf einer Route laden und zu einer durchgehenden Linie zusammensetzen. */
export async function ladeRoute(id: number): Promise<Route> {
  const antwort = await fetch(`${DIENST}/details/relation/${id}`)
  if (!antwort.ok) throw new Error('Diese Wanderroute konnte nicht geladen werden.')
  const daten = await antwort.json()
  const stuecke: [number, number][][] = []
  sammle(daten.route, stuecke)
  const brauchbar = stuecke.filter((s) => s.length >= 2)
  if (brauchbar.length === 0) throw new Error('Zu dieser Wanderroute gibt es keinen Wegverlauf.')

  // Erstes Stück so drehen, dass sein Ende zum zweiten Stück zeigt
  if (brauchbar.length > 1) {
    const erstes = brauchbar[0]
    const zweites = brauchbar[1]
    const vomEnde = Math.min(
      abstand(erstes[erstes.length - 1], zweites[0]),
      abstand(erstes[erstes.length - 1], zweites[zweites.length - 1]),
    )
    const vomAnfang = Math.min(abstand(erstes[0], zweites[0]), abstand(erstes[0], zweites[zweites.length - 1]))
    if (vomAnfang < vomEnde) erstes.reverse()
  }

  const ketten: [number, number][][] = []
  let kette: [number, number][] = brauchbar[0].slice()
  for (let i = 1; i < brauchbar.length; i++) {
    const stueck = brauchbar[i]
    const ende = kette[kette.length - 1]
    const zumAnfang = abstand(ende, stueck[0])
    const zumEnde = abstand(ende, stueck[stueck.length - 1])
    const richtig = zumEnde < zumAnfang ? stueck.slice().reverse() : stueck
    if (Math.min(zumAnfang, zumEnde) > 300) {
      ketten.push(kette)
      kette = richtig.slice()
    } else {
      const start = Math.min(zumAnfang, zumEnde) < 1 ? 1 : 0
      for (let k = start; k < richtig.length; k++) kette.push(richtig[k])
    }
  }
  ketten.push(kette)

  let beste = ketten[0]
  let besteLaenge = laenge(beste)
  for (const k of ketten.slice(1)) {
    const l = laenge(k)
    if (l > besteLaenge) {
      beste = k
      besteLaenge = l
    }
  }

  return {
    id,
    name: daten.name || (daten.ref ? `Weg ${daten.ref}` : 'Wanderroute'),
    linie: beste,
    meter: besteLaenge,
    unvollstaendig: ketten.length > 1,
  }
}

/**
 * Aus einer Wanderroute eine eigene Tour machen. Jeder Abschnitt wird über eng
 * gesetzte Zwischenpunkte noch einmal vom Routing-Dienst berechnet – so stammen
 * die Höhen aus derselben Quelle wie bei selbst geplanten Touren. Klappt das für
 * einen Abschnitt nicht (oder käme ein Umweg heraus), bleibt der Originalverlauf
 * und die Höhen kommen aus dem Geländemodell.
 */
export async function alsTour(route: Route): Promise<Tour> {
  const tour = ausPunkten(
    route.name,
    route.linie.map(([lon, lat]) => [lon, lat, NaN] as Punkt),
  )

  async function abschnitt(original: Punkt[]): Promise<Punkt[]> {
    const strecke = kumuliert(original)
    const gesamt = strecke[strecke.length - 1]
    const ueber: Wegpunkt[] = [{ lon: original[0][0], lat: original[0][1] }]
    let naechste = 300
    for (let i = 1; i < original.length - 1; i++) {
      if (strecke[i] >= naechste && gesamt - strecke[i] > 100) {
        ueber.push({ lon: original[i][0], lat: original[i][1] })
        naechste = strecke[i] + 300
      }
    }
    const letzter = original[original.length - 1]
    ueber.push({ lon: letzter[0], lat: letzter[1] })
    try {
      const berechnet = await routeUeber(ueber)
      const neu = kumuliert(berechnet)
      if (neu[neu.length - 1] <= gesamt * 1.5 + 200) return berechnet
    } catch {
      // unten weiter mit dem Originalverlauf
    }
    return hoehenErgaenzen(original)
  }

  const abschnitte: Punkt[][] = new Array(tour.abschnitte.length)
  let naechster = 0
  async function arbeiter() {
    while (naechster < tour.abschnitte.length) {
      const i = naechster++
      abschnitte[i] = await abschnitt(tour.abschnitte[i] as Punkt[])
    }
  }
  await Promise.all([arbeiter(), arbeiter(), arbeiter()])

  // Wegpunkte auf die Nahtstellen der berechneten Abschnitte setzen
  const wegpunkte: Wegpunkt[] = abschnitte.map((a) => ({ lon: a[0][0], lat: a[0][1] }))
  const ende = abschnitte[abschnitte.length - 1]
  wegpunkte.push({ lon: ende[ende.length - 1][0], lat: ende[ende.length - 1][1] })
  return { ...tour, wegpunkte, abschnitte }
}
