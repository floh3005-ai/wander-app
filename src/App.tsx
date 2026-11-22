import { useEffect, useMemo, useRef, useState } from 'react'
import Karte, { type Flug } from './components/Karte'
import Hoehenprofil from './components/Hoehenprofil'
import AmWeg from './components/AmWeg'
import Fotos, { FotoGross } from './components/Fotos'
import Geschwindigkeit from './components/Geschwindigkeit'
import Schwierigkeit from './components/Schwierigkeit'
import Statistik from './components/Statistik'
import TempoEinstellung from './components/TempoEinstellung'
import { ladeFotosHoch, loescheBild, merkeBild, waehleDateien } from './lib/fotos'
import Unterwegs from './components/Unterwegs'
import { ladeLauf } from './lib/aufzeichnung'
import { istApp } from './lib/standort'
import { umgedreht } from './lib/schwierigkeit'
import Konto, { type AbgleichStand } from './components/Konto'
import { abgleichen, zusammenfuehren } from './lib/abgleich'
import { cloud, cloudAblage, fehlerText } from './lib/cloud'
import Vorlagen from './components/Vorlagen'
import Wetter from './components/Wetter'
import { hoehenErgaenzen, hoehenFehlen } from './lib/hoehe'
import { sucheAmWeg } from './lib/orte'
import { alsTour, type Route } from './lib/vorlagen'
import { freihandLinie, luftlinie, route } from './lib/brouter'
import { amWanderweg, daneben } from './lib/wanderweg'
import {
  formatDauer,
  formatKm,
  zeitFuerWeg,
  hoehenmeter,
  kumuliert,
  entfernung,
  naechsterIndex,
  zusammensetzen,
} from './lib/geo'
import { alsGpx, ausGpx, ausPunkten, dateiname, herunterladen } from './lib/gpx'
import {
  ladeAktiveId,
  ladeAnsicht,
  ladeGeloeschte,
  ladeTouren,
  speichereAktiveId,
  speichereGeloeschte,
  speichereTouren,
} from './lib/speicher'
import {
  neueTour,
  wegKennung,
  type FotoInfo,
  type Kategorie,
  type Ort,
  type Punkt,
  type Tour,
  type Wegpunkt,
} from './lib/typen'

interface Treffer {
  name: string
  zusatz: string
  lon: number
  lat: number
}

const nichtLeer = (t: Tour) => t.wegpunkte.length > 0 || !!t.name

function start(): { touren: Tour[]; aktivId: string } {
  const touren = ladeTouren().filter((t) => t.wegpunkte.length > 0 || t.name)
  const gemerkt = ladeAktiveId()
  let aktiv = touren.find((t) => t.id === gemerkt)
  if (!aktiv) {
    aktiv = neueTour()
    touren.unshift(aktiv)
  }
  return { touren, aktivId: aktiv.id }
}

function kennzahlen(tour: Tour) {
  const punkte = zusammensetzen(tour.abschnitte)
  const strecke = kumuliert(punkte)
  const meter = strecke[strecke.length - 1] ?? 0
  const h = hoehenmeter(punkte)
  const a = tour.aufzeichnung
  // Aufgezeichnete Wanderung: die gemessenen Werte zeigen, nicht nachrechnen
  if (a) return { punkte, meter: a.meter, max: h.max, min: h.min, auf: a.auf, ab: a.ab, minuten: a.gehzeit / 60 }
  return { punkte, meter, ...h, minuten: zeitFuerWeg(punkte) }
}

function rahmen(tour: Tour): [number, number, number, number] | null {
  const alle: [number, number][] = tour.wegpunkte.map((w) => [w.lon, w.lat])
  for (const a of tour.abschnitte) if (a) for (const p of a) alle.push([p[0], p[1]])
  if (alle.length === 0) return null
  let w = Infinity
  let s = Infinity
  let o = -Infinity
  let n = -Infinity
  for (const [lon, lat] of alle) {
    if (lon < w) w = lon
    if (lon > o) o = lon
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return [w, s, o, n]
}

export default function App() {
  const anfang = useMemo(start, [])
  const [touren, setTouren] = useState<Tour[]>(anfang.touren)
  const [aktivId, setAktivId] = useState(anfang.aktivId)
  const [hover, setHover] = useState<Punkt | null>(null)
  const [flug, setFlug] = useState<Flug | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [basis, setBasis] = useState<'topo' | 'osm'>(() => ladeAnsicht().basis)
  const [wanderwege, setWanderwege] = useState(() => ladeAnsicht().wanderwege)
  const [suche, setSuche] = useState('')
  const [orte, setOrte] = useState<Treffer[] | null>(null)
  const [freihand, setFreihand] = useState(false)
  const [gesucht, setGesucht] = useState<{ lon: number; lat: number; name: string } | null>(null)
  const [sichtbar, setSichtbar] = useState<Set<Kategorie>>(
    () => new Set<Kategorie>(['gipfel', 'aussicht', 'einkehr', 'schutz', 'burg', 'sehenswert', 'wasser']),
  )
  const [orteLaedt, setOrteLaedt] = useState(false)
  const [gewaehlterOrt, setGewaehlterOrt] = useState<{ nr: number; ort: Ort } | null>(null)
  const [vorschau, setVorschau] = useState<[number, number][] | null>(null)
  const ausschnitt = useRef<{ rahmen: [number, number, number, number]; zoom: number } | null>(null)
  // Am Handy (oder wenn gerade aufgezeichnet wird) gleich in die Unterwegs-Ansicht
  const [modus, setModus] = useState<'planen' | 'unterwegs'>(() =>
    istApp || window.innerWidth < 700 || ladeLauf() ? 'unterwegs' : 'planen',
  )
  const [fotoOffen, setFotoOffen] = useState<FotoInfo | null>(null)
  const [fotoLaedt, setFotoLaedt] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [abgleich, setAbgleich] = useState<AbgleichStand>('aus')
  const [abgleichZeit, setAbgleichZeit] = useState<Date | null>(null)
  const [abgleichFehler, setAbgleichFehler] = useState<string | null>(null)
  const tourenJetzt = useRef(touren)
  tourenJetzt.current = touren
  const emailJetzt = useRef(email)
  emailJetzt.current = email
  const abgleichLaeuft = useRef(false)
  const flugNr = useRef(0)
  const dateiFeld = useRef<HTMLInputElement>(null)

  const aktiv = touren.find((t) => t.id === aktivId) ?? touren[0]
  // zählt hoch, wenn das Tempo geändert wurde – dann werden alle Zeiten neu gerechnet
  const [tempoStand, setTempoStand] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const zahlen = useMemo(() => kennzahlen(aktiv), [aktiv, tempoStand])
  const rechnet = aktiv.abschnitte.some((a) => a === null)

  // automatisch speichern
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!speichereTouren(touren)) {
        setMeldung('Speichern hat nicht geklappt – der Browser-Speicher ist voll.')
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [touren])

  useEffect(() => {
    speichereAktiveId(aktivId)
  }, [aktivId])

  // ---------- Cloud ----------

  /** Touren mit der Cloud abgleichen (nur wenn angemeldet). */
  async function gleicheAb() {
    if (!cloud || !emailJetzt.current || abgleichLaeuft.current) return
    abgleichLaeuft.current = true
    setAbgleich('laeuft')
    const schnappschuss = tourenJetzt.current.filter(nichtLeer)
    try {
      const ergebnis = await abgleichen(cloudAblage, schnappschuss, ladeGeloeschte())
      const vermerke = ladeGeloeschte()
      for (const id of ergebnis.erledigt) delete vermerke[id]
      speichereGeloeschte(vermerke)
      setTouren((jetzt) => {
        const neu = zusammenfuehren(jetzt, schnappschuss, ergebnis.touren)
        return neu.length > 0 ? neu : [neueTour()]
      })
      await ladeFotosHoch()
      setAbgleich('ok')
      setAbgleichZeit(new Date())
      setAbgleichFehler(null)
    } catch (e) {
      setAbgleich('fehler')
      setAbgleichFehler(fehlerText(e))
    }
    abgleichLaeuft.current = false
  }

  async function anmelden(mail: string, passwort: string): Promise<string | null> {
    if (!cloud) return 'Die Cloud ist noch nicht eingerichtet.'
    const { error } = await cloud.auth.signInWithPassword({ email: mail, password: passwort })
    return error ? fehlerText(error) : null
  }

  // Anmeldung merken und auf An-/Abmelden reagieren
  useEffect(() => {
    if (!cloud) return
    cloud.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null))
    const { data } = cloud.auth.onAuthStateChange((_ereignis, sitzung) => {
      setEmail(sitzung?.user.email ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Abgleichen: gleich nach dem Anmelden, ein paar Sekunden nach jeder Änderung
  // und wenn man zum Fenster zurückkommt
  useEffect(() => {
    if (email) gleicheAb()
    else setAbgleich('aus')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email])

  const tourenKennung = touren
    .filter(nichtLeer)
    .map((t) => t.id + t.geaendert)
    .join('|')
  useEffect(() => {
    if (!email) return
    const timer = setTimeout(gleicheAb, 4000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourenKennung, email])

  useEffect(() => {
    const beiRueckkehr = () => {
      if (document.visibilityState === 'visible') gleicheAb()
    }
    document.addEventListener('visibilitychange', beiRueckkehr)
    return () => document.removeEventListener('visibilitychange', beiRueckkehr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wurde die offene Tour woanders gelöscht, die erste verbleibende öffnen
  useEffect(() => {
    if (!touren.some((t) => t.id === aktivId)) setAktivId(touren[0].id)
  }, [touren, aktivId])

  // Meldung nach ein paar Sekunden ausblenden
  useEffect(() => {
    if (!meldung) return
    const timer = setTimeout(() => setMeldung(null), 6000)
    return () => clearTimeout(timer)
  }, [meldung])

  // Beim Öffnen einer Tour: hinspringen und unterbrochene Berechnungen nachholen
  useEffect(() => {
    const tour = touren.find((t) => t.id === aktivId)
    if (!tour) return
    const r = rahmen(tour)
    if (r) fliege({ rahmen: r })
    tour.abschnitte.forEach((a, i) => {
      if (a === null) berechne(tour.wegpunkte[i], tour.wegpunkte[i + 1])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktivId])

  function fliege(ziel: Omit<Flug, 'nr'>) {
    flugNr.current += 1
    setFlug({ nr: flugNr.current, ...ziel })
  }

  function aendere(fn: (t: Tour) => Tour) {
    setTouren((alle) =>
      alle.map((t) => (t.id === aktivId ? { ...fn(t), geaendert: new Date().toISOString() } : t)),
    )
  }

  /** Ergebnis einer Berechnung eintragen – nur wenn die beiden Wegpunkte noch Nachbarn sind. */
  function trageEin(a: Wegpunkt, b: Wegpunkt, punkte: Punkt[]) {
    setTouren((alle) =>
      alle.map((t) => {
        const i = t.wegpunkte.indexOf(a)
        if (i < 0 || t.wegpunkte[i + 1] !== b) return t
        const abschnitte = t.abschnitte.slice()
        abschnitte[i] = punkte
        return { ...t, abschnitte, geaendert: new Date().toISOString() }
      }),
    )
  }

  function berechne(a: Wegpunkt, b: Wegpunkt) {
    if (b.frei) {
      // Freihand: gerade Linie sofort zeigen, Höhen kommen nach
      const linie = freihandLinie(a, b)
      trageEin(a, b, linie)
      hoehenErgaenzen(linie)
        .then((mitHoehe) => trageEin(a, b, mitHoehe))
        .catch(() => {})
      return
    }
    route(a, b)
      .catch(() => null)
      .then(async (punkte) => {
        // Passt das Ergebnis? Der Routenplaner kennt nicht jeden eingezeichneten Weg:
        // dann landet er weit neben dem Klick oder läuft einen großen Umweg.
        const gerade = entfernung(a.lon, a.lat, b.lon, b.lat)
        const meter = punkte ? kumuliert(punkte).at(-1)! : Infinity
        const versetzt = punkte ? daneben(punkte, a, b) : Infinity
        const umweg = meter > gerade * 2.5 + 300
        if (versetzt <= 35 && !umweg) return trageEin(a, b, punkte!)

        if (punkte) trageEin(a, b, punkte)
        const markiert = await amWanderweg(a, b).catch(() => null)
        if (markiert && (versetzt > 35 || markiert.meter < meter * 0.7)) {
          trageEin(a, b, markiert.punkte)
          setMeldung(`Dieses Stück folgt dem markierten Wanderweg „${markiert.name}“ – der Routenplaner kennt ihn nicht.`)
        } else if (!punkte) {
          setMeldung(
            'Zwischen diesen Punkten wurde kein Weg gefunden – ich habe eine gerade Linie eingezeichnet. Für eingezeichnete Wege, die der Routenplaner nicht kennt: oben „Freihand“ einschalten.',
          )
          trageEin(a, b, luftlinie(a, b))
        } else if (versetzt > 35) {
          setMeldung(
            'Der Routenplaner kennt an dieser Stelle keinen Weg und ist auf den nächsten bekannten ausgewichen. Zum Nachzeichnen oben „Freihand“ einschalten.',
          )
        }
      })
  }

  /** Aufgezeichnete Wanderungen bleiben, wie sie gelaufen wurden. */
  function gesperrt(): boolean {
    if (!aktiv.aufzeichnung) return false
    setMeldung('Das ist eine aufgezeichnete Wanderung. Zum Ändern erst „Als neue Tour planen“ wählen.')
    return true
  }

  /** Aus einer aufgezeichneten Wanderung eine neue, planbare Tour machen. */
  function alsVorlage() {
    const tour = ausPunkten(`${aktiv.name} (geplant)`, zahlen.punkte)
    setTouren((alle) => [tour, ...alle])
    setAktivId(tour.id)
  }

  function punktDazu(lon: number, lat: number) {
    if (gesperrt()) return
    const neu: Wegpunkt = freihand && aktiv.wegpunkte.length > 0 ? { lon, lat, frei: true } : { lon, lat }
    const vorher = aktiv.wegpunkte[aktiv.wegpunkte.length - 1]
    aendere((t) => ({
      ...t,
      wegpunkte: [...t.wegpunkte, neu],
      abschnitte: t.wegpunkte.length > 0 ? [...t.abschnitte, null] : t.abschnitte,
    }))
    if (vorher) berechne(vorher, neu)
  }

  function punktVerschoben(i: number, lon: number, lat: number) {
    if (gesperrt()) return
    const neu: Wegpunkt = aktiv.wegpunkte[i]?.frei ? { lon, lat, frei: true } : { lon, lat }
    const davor = aktiv.wegpunkte[i - 1]
    const danach = aktiv.wegpunkte[i + 1]
    aendere((t) => {
      const wegpunkte = t.wegpunkte.slice()
      wegpunkte[i] = neu
      const abschnitte = t.abschnitte.slice()
      if (i > 0) abschnitte[i - 1] = null
      if (i < wegpunkte.length - 1) abschnitte[i] = null
      return { ...t, wegpunkte, abschnitte }
    })
    if (davor) berechne(davor, neu)
    if (danach) berechne(neu, danach)
  }

  function punktEntfernen(i: number) {
    if (gesperrt()) return
    const davor = aktiv.wegpunkte[i - 1]
    const danach = aktiv.wegpunkte[i + 1]
    aendere((t) => {
      const wegpunkte = t.wegpunkte.slice()
      wegpunkte.splice(i, 1)
      const abschnitte = t.abschnitte.slice()
      if (i === 0) abschnitte.shift()
      else if (i === t.wegpunkte.length - 1) abschnitte.pop()
      else abschnitte.splice(i - 1, 2, null)
      return { ...t, wegpunkte, abschnitte }
    })
    if (davor && danach) berechne(davor, danach)
  }

  /** Klick auf die Linie: dort einen neuen Wegpunkt einfügen, den man dann ziehen kann. */
  function linieGeklickt(nr: number, lon: number, lat: number) {
    if (gesperrt()) return
    const abschnitt = aktiv.abschnitte[nr]
    if (!abschnitt || abschnitt.length < 3) return
    const k = Math.min(abschnitt.length - 2, Math.max(1, naechsterIndex(abschnitt, lon, lat)))
    const neu: Wegpunkt = { lon: abschnitt[k][0], lat: abschnitt[k][1] }
    if (aktiv.wegpunkte[nr + 1]?.frei) neu.frei = true
    aendere((t) => {
      const wegpunkte = t.wegpunkte.slice()
      wegpunkte.splice(nr + 1, 0, neu)
      const abschnitte = t.abschnitte.slice()
      abschnitte.splice(nr, 1, abschnitt.slice(0, k + 1), abschnitt.slice(k))
      return { ...t, wegpunkte, abschnitte }
    })
  }

  function zurueckZumStart() {
    if (gesperrt()) return
    const erster = aktiv.wegpunkte[0]
    if (!erster || aktiv.wegpunkte.length < 2) return
    punktDazu(erster.lon, erster.lat)
  }

  function umkehren() {
    if (gesperrt()) return
    aendere((t) => ({
      ...t,
      // Das Freihand-Zeichen gehört zum Stück, nicht zum Punkt – es wandert beim Umdrehen ans andere Ende
      wegpunkte: t.wegpunkte
        .slice()
        .reverse()
        .map((w, i, alle) => {
          const frei = i > 0 && t.wegpunkte[alle.length - i]?.frei
          return frei ? { lon: w.lon, lat: w.lat, frei: true } : { lon: w.lon, lat: w.lat }
        }),
      abschnitte: t.abschnitte
        .slice()
        .reverse()
        .map((a) => (a ? umgedreht(a) : null)),
    }))
  }

  function neu() {
    const t = neueTour()
    setTouren((alle) => [t, ...alle.filter((x) => x.wegpunkte.length > 0 || x.name)])
    setAktivId(t.id)
  }

  function loeschen(tour: Tour) {
    if (!window.confirm(
        `Tour „${tour.name || 'Ohne Namen'}“ wirklich löschen?${tour.fotos?.length ? ` Ihre ${tour.fotos.length} Fotos werden mit gelöscht.` : ''}`,
      )) return
    if (nichtLeer(tour)) {
      speichereGeloeschte({ ...ladeGeloeschte(), [tour.id]: new Date().toISOString() })
    }
    for (const f of tour.fotos ?? []) loescheBild(f.id).catch(() => {})
    const rest = touren.filter((t) => t.id !== tour.id)
    if (tour.id === aktivId || rest.length === 0) {
      const t = neueTour()
      setTouren([t, ...rest.filter(nichtLeer)])
      setAktivId(t.id)
    } else {
      setTouren(rest)
    }
  }

  /** Fotos vom PC (oder aus der Handy-Galerie) an die Tour hängen. */
  async function fotosDazu() {
    setFotoLaedt(true)
    try {
      const bilder = await waehleDateien(true)
      const neu: FotoInfo[] = []
      for (const b of bilder) {
        const id = crypto.randomUUID()
        await merkeBild(id, b.bild)
        // Ortsstempel und Aufnahmezeit aus dem Foto übernehmen, wenn vorhanden
        neu.push({ id, zeit: b.zeit ?? new Date().toISOString(), lon: b.lon, lat: b.lat })
      }
      if (neu.length > 0) {
        aendere((t) => ({
          ...t,
          fotos: [...(t.fotos ?? []), ...neu].sort((x, y) => (x.zeit < y.zeit ? -1 : 1)),
        }))
        const ohneOrt = neu.filter((f) => f.lon === undefined).length
        setMeldung(
          ohneOrt === 0
            ? `${neu.length} Foto${neu.length === 1 ? '' : 's'} hinzugefügt und auf der Karte eingetragen.`
            : `${neu.length} Foto${neu.length === 1 ? '' : 's'} hinzugefügt. ${ohneOrt} davon ohne Ortsstempel – ${ohneOrt === 1 ? 'es steht' : 'sie stehen'} nur in der Foto-Kachel.`,
        )
      }
    } catch {
      setMeldung('Die Fotos konnten nicht gespeichert werden.')
    }
    setFotoLaedt(false)
  }

  function fotoLoeschen(foto: FotoInfo) {
    if (!window.confirm('Dieses Foto wirklich löschen? Es ist dann überall weg.')) return
    aendere((t) => ({ ...t, fotos: (t.fotos ?? []).filter((f) => f.id !== foto.id) }))
    loescheBild(foto.id).catch(() => {})
    setFotoOffen(null)
  }

  /** Sehenswertes und Nützliches entlang der aktuellen Tour suchen. */
  async function amWegSuchen() {
    const tour = aktiv
    const kennung = wegKennung(tour)
    setOrteLaedt(true)
    try {
      const orte = await sucheAmWeg(zahlen.punkte)
      setTouren((alle) => alle.map((t) => (t.id === tour.id ? { ...t, orte, orteFuer: kennung, geaendert: new Date().toISOString() } : t)))
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Die Suche hat nicht geklappt.')
    }
    setOrteLaedt(false)
  }

  function ortWaehlen(ort: Ort) {
    flugNr.current += 1
    setGewaehlterOrt({ nr: flugNr.current, ort })
    fliege({ mitte: [ort.lon, ort.lat], zoom: 15 })
  }

  function kategorieUmschalten(kat: Kategorie) {
    setSichtbar((alt) => {
      const neu = new Set(alt)
      if (neu.has(kat)) neu.delete(kat)
      else neu.add(kat)
      return neu
    })
  }

  function routeVorschau(route: Route | null) {
    setVorschau(route ? route.linie : null)
    if (!route) return
    let w = Infinity
    let s = Infinity
    let o = -Infinity
    let n = -Infinity
    for (const [lon, lat] of route.linie) {
      if (lon < w) w = lon
      if (lon > o) o = lon
      if (lat < s) s = lat
      if (lat > n) n = lat
    }
    fliege({ rahmen: [w, s, o, n] })
  }

  /** Ausgeschilderte Wanderroute als eigene, anpassbare Tour übernehmen. */
  async function routeUebernehmen(route: Route) {
    const tour = await alsTour(route)
    setTouren((alle) => [tour, ...alle.filter((x) => x.wegpunkte.length > 0 || x.name)])
    setAktivId(tour.id)
    setMeldung(`„${tour.name}“ ist jetzt Deine Tour. Du kannst sie frei anpassen.`)
  }

  async function importieren(datei: File | undefined) {
    if (!datei) return
    try {
      let tour = ausGpx(await datei.text(), datei.name)
      const verlauf = zusammensetzen(tour.abschnitte)
      if (hoehenFehlen(verlauf)) {
        // GPX ohne Höhen: aus dem Geländemodell nachtragen
        tour = { ...ausPunkten(tour.name, await hoehenErgaenzen(verlauf)), id: tour.id }
      }
      setTouren((alle) => [tour, ...alle.filter((x) => x.wegpunkte.length > 0 || x.name)])
      setAktivId(tour.id)
      setMeldung(`„${tour.name}“ wurde als neue Tour übernommen. Du kannst sie jetzt anpassen.`)
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Die Datei konnte nicht gelesen werden.')
    }
    if (dateiFeld.current) dateiFeld.current.value = ''
  }

  async function ortSuchen(ev: React.FormEvent) {
    ev.preventDefault()
    const frage = suche.trim()
    if (!frage) return
    try {
      const antwort = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(frage)}&limit=6&lang=de`,
      )
      const daten = await antwort.json()
      const gefunden: Treffer[] = (daten.features ?? []).map((f: any) => ({
        name: f.properties.name ?? frage,
        zusatz: [f.properties.city, f.properties.state, f.properties.country]
          .filter((x: string | undefined, i: number, alle: (string | undefined)[]) => x && alle.indexOf(x) === i)
          .join(', '),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      }))
      const gesehen = new Set<string>()
      setOrte(
        gefunden.filter((o) => {
          const schluessel = `${o.name}|${o.zusatz}`
          if (gesehen.has(schluessel)) return false
          gesehen.add(schluessel)
          return true
        }),
      )
    } catch {
      setMeldung('Die Ortssuche ist gerade nicht erreichbar.')
    }
  }

  const andere = touren.filter((t) => t.id !== aktivId && (t.wegpunkte.length > 0 || t.name))
  const hatWeg = aktiv.wegpunkte.length >= 2
  const orteAufKarte = useMemo(
    () => (aktiv.orte ?? []).filter((o) => sichtbar.has(o.kat)),
    [aktiv.orte, sichtbar],
  )

  const konto = (
    <Konto
      eingerichtet={cloud !== null}
      email={email}
      stand={abgleich}
      zuletzt={abgleichZeit}
      fehler={abgleichFehler}
      onAnmelden={anmelden}
      onAbmelden={() => cloud?.auth.signOut()}
      onAbgleichen={gleicheAb}
    />
  )

  if (modus === 'unterwegs') {
    return (
      <Unterwegs
        touren={touren.filter(nichtLeer)}
        konto={konto}
        onSpeichern={(tour) => setTouren((alle) => [tour, ...alle])}
        onZumPlaner={() => setModus('planen')}
      />
    )
  }

  return (
    <div className="app">
      <aside className="seite">
        <header className="kopf">
          <h1>Wander-App</h1>
          <span className="stufe">Tourenplaner</span>
          <button type="button" className="zu-unterwegs" onClick={() => setModus('unterwegs')}>
            🥾 Unterwegs
          </button>
        </header>

        {konto}

        <form className="suche" onSubmit={ortSuchen}>
          <input
            type="search"
            placeholder="Ort oder Berg suchen …"
            value={suche}
            onChange={(e) => {
              setSuche(e.target.value)
              if (!e.target.value) setOrte(null)
            }}
            aria-label="Ort suchen"
          />
          <button type="submit">Suchen</button>
        </form>
        {orte && (
          <ul className="orte">
            {orte.length === 0 && <li className="leer">Nichts gefunden.</li>}
            {orte.map((o, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    fliege({ mitte: [o.lon, o.lat] })
                    setGesucht({ lon: o.lon, lat: o.lat, name: o.name })
                    setOrte(null)
                  }}
                >
                  <strong>{o.name}</strong>
                  {o.zusatz && <span>{o.zusatz}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <section className="karte-block">
          <label className="feld">
            <span>Name der Tour</span>
            <input
              type="text"
              placeholder="z. B. Rund um den Eibsee"
              value={aktiv.name}
              onChange={(e) => aendere((t) => ({ ...t, name: e.target.value }))}
            />
          </label>

          <dl className="zahlen">
            <div>
              <dt>Strecke</dt>
              <dd>{formatKm(zahlen.meter)} km</dd>
            </div>
            <div>
              <dt>{aktiv.aufzeichnung ? 'Reine Gehzeit' : 'Geplante Zeit'}</dt>
              <dd>{hatWeg ? formatDauer(zahlen.minuten) : '–'}</dd>
            </div>
            <div>
              <dt>Bergauf</dt>
              <dd>{Math.round(zahlen.auf)} m</dd>
            </div>
            <div>
              <dt>Bergab</dt>
              <dd>{Math.round(zahlen.ab)} m</dd>
            </div>
            <div>
              <dt>Höchster Punkt</dt>
              <dd>{zahlen.max !== null ? `${Math.round(zahlen.max)} m` : '–'}</dd>
            </div>
            <div>
              <dt>Tiefster Punkt</dt>
              <dd>{zahlen.min !== null ? `${Math.round(zahlen.min)} m` : '–'}</dd>
            </div>
          </dl>

          {!aktiv.aufzeichnung && <Schwierigkeit
            punkte={zahlen.punkte}
            onZeigen={(p) => fliege({ mitte: [p[0], p[1]], zoom: 15 })}
          />}

          {aktiv.aufzeichnung && (
            <p className="gewandert">
              🥾 Aufgezeichnet am{' '}
              {new Date(aktiv.aufzeichnung.beginn).toLocaleDateString('de-DE', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              . Die Werte sind gemessen.{' '}
              <button type="button" onClick={alsVorlage}>
                Als neue Tour planen
              </button>
            </p>
          )}

          <p className="hinweis">
            {aktiv.wegpunkte.length === 0
              ? 'Klick auf die Karte, um den Startpunkt zu setzen.'
              : freihand
                ? 'Freihand ist an: Jeder Klick wird mit einem geraden Strich verbunden. So zeichnest Du Wege nach, die der Routenplaner nicht kennt. Danach Freihand wieder ausschalten.'
                : aktiv.wegpunkte.length === 1
                ? 'Jetzt den nächsten Punkt anklicken – der Weg wird automatisch auf das Wegenetz gelegt.'
                : 'Punkt ziehen = Weg ändern · Klick auf die Linie = Punkt einfügen · Rechtsklick auf Punkt = entfernen'}
          </p>

          <div className="knoepfe">
            <button
              type="button"
              disabled={aktiv.wegpunkte.length === 0}
              onClick={() => punktEntfernen(aktiv.wegpunkte.length - 1)}
            >
              Letzten Punkt zurück
            </button>
            <button type="button" disabled={!hatWeg} onClick={zurueckZumStart}>
              Zurück zum Start
            </button>
            <button type="button" disabled={!hatWeg} onClick={umkehren}>
              Richtung umkehren
            </button>
            <button
              type="button"
              disabled={!hatWeg || rechnet}
              onClick={() => herunterladen(dateiname(aktiv), alsGpx(aktiv))}
            >
              GPX speichern
            </button>
          </div>
          <p className="status">{rechnet ? 'Weg wird berechnet …' : 'Automatisch gespeichert'}</p>
        </section>

        <details className="klapp">
          <summary>Wetter zur Tour</summary>
          <Wetter
            punkte={zahlen.punkte}
            minuten={zahlen.minuten}
            start={aktiv.start}
            onStart={(start) => aendere((t) => ({ ...t, start }))}
          />
        </details>

        <details className="klapp">
          <summary>
            Am Weg{aktiv.orte ? <span className="zahl">{aktiv.orte.length}</span> : null}
          </summary>
          <AmWeg
            hatWeg={hatWeg && !rechnet}
            orte={aktiv.orte}
            veraltet={aktiv.orteFuer !== wegKennung(aktiv)}
            laedt={orteLaedt}
            sichtbar={sichtbar}
            onSuchen={amWegSuchen}
            onUmschalten={kategorieUmschalten}
            onWaehlen={ortWaehlen}
          />
        </details>

        <details className="klapp">
          <summary>
            Fotos{aktiv.fotos?.length ? <span className="zahl">{aktiv.fotos.length}</span> : null}
          </summary>
          <Fotos fotos={aktiv.fotos ?? []} laedt={fotoLaedt} onDazu={fotosDazu} onOeffnen={setFotoOffen} />
        </details>

        <details className="klapp">
          <summary>Wanderrouten als Vorlage</summary>
          <Vorlagen
            ausschnitt={() => ausschnitt.current}
            onVorschau={routeVorschau}
            onUebernehmen={routeUebernehmen}
          />
        </details>

        <details className="klapp">
          <summary>Mein Tempo</summary>
          <TempoEinstellung onGeaendert={() => setTempoStand((n) => n + 1)} />
        </details>

        <details className="klapp">
          <summary>Statistik</summary>
          <Statistik touren={touren} />
        </details>

        <section className="liste-block">
          <div className="liste-kopf">
            <h2>Meine Touren</h2>
            <div>
              <button type="button" onClick={() => dateiFeld.current?.click()}>
                GPX laden
              </button>
              <button type="button" className="haupt" onClick={neu}>
                Neue Tour
              </button>
            </div>
          </div>
          <input
            ref={dateiFeld}
            type="file"
            accept=".gpx,application/gpx+xml"
            hidden
            onChange={(e) => importieren(e.target.files?.[0])}
          />
          <ul className="touren">
            <li className="aktiv">
              <span className="tour-name">{aktiv.name || 'Neue Tour (ohne Namen)'}</span>
              <span className="tour-info">wird gerade bearbeitet</span>
              {(aktiv.wegpunkte.length > 0 || aktiv.name) && (
                <button type="button" className="weg" onClick={() => loeschen(aktiv)} title="Tour löschen">
                  Löschen
                </button>
              )}
            </li>
            {andere.map((t) => {
              const z = kennzahlen(t)
              return (
                <li key={t.id}>
                  <button type="button" className="tour-knopf" onClick={() => setAktivId(t.id)}>
                    <span className="tour-name">
                      {t.aufzeichnung ? '🥾 ' : ''}
                      {t.name || 'Ohne Namen'}
                    </span>
                    <span className="tour-info">
                      {formatKm(z.meter)} km · {Math.round(z.auf)} m bergauf · {formatDauer(z.minuten)}
                    </span>
                  </button>
                  <button type="button" className="weg" onClick={() => loeschen(t)} title="Tour löschen">
                    Löschen
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </aside>

      <main className="haupt-bereich">
        <div className="karten-rahmen">
          <Karte
            wegpunkte={aktiv.wegpunkte}
            abschnitte={aktiv.abschnitte}
            hover={hover}
            flug={flug}
            basis={basis}
            wanderwege={wanderwege}
            onKarteKlick={punktDazu}
            onLinieKlick={linieGeklickt}
            onVerschoben={punktVerschoben}
            onEntfernen={punktEntfernen}
            orte={orteAufKarte}
            gewaehlterOrt={gewaehlterOrt}
            vorschau={vorschau}
            gesucht={gesucht}
            onGesuchtWeg={() => setGesucht(null)}
            fest={!!aktiv.aufzeichnung}
            fotos={aktiv.fotos}
            onFoto={(id) => setFotoOffen(aktiv.fotos?.find((f) => f.id === id) ?? null)}
            onAusschnitt={(rahmen, zoom) => (ausschnitt.current = { rahmen, zoom })}
          />
          <div className="schalter">
            <button type="button" className={basis === 'topo' ? 'an' : ''} onClick={() => setBasis('topo')}>
              Wanderkarte
            </button>
            <button type="button" className={basis === 'osm' ? 'an' : ''} onClick={() => setBasis('osm')}>
              Standard
            </button>
            <label>
              <input
                type="checkbox"
                checked={wanderwege}
                onChange={(e) => setWanderwege(e.target.checked)}
              />
              Wanderwege
            </label>
            {!aktiv.aufzeichnung && (
              <label
                className={freihand ? 'freihand an' : 'freihand'}
                title="Punkte mit geraden Strichen verbinden – für Wege, die der Routenplaner nicht kennt"
              >
                <input type="checkbox" checked={freihand} onChange={(e) => setFreihand(e.target.checked)} />
                ✏️ Freihand
              </label>
            )}
          </div>
          {meldung && (
            <div className="meldung" role="status">
              {meldung}
            </div>
          )}
        </div>
        <Hoehenprofil punkte={zahlen.punkte} onHover={setHover} />
        {aktiv.aufzeichnung && <Geschwindigkeit tour={aktiv} onHover={setHover} />}
      </main>
      {fotoOffen && (
        <FotoGross
          foto={fotoOffen}
          onSchliessen={() => setFotoOffen(null)}
          onLoeschen={() => fotoLoeschen(fotoOffen)}
          onZeigen={() => {
            if (fotoOffen.lon !== undefined && fotoOffen.lat !== undefined) {
              fliege({ mitte: [fotoOffen.lon, fotoOffen.lat], zoom: 16 })
            }
            setFotoOffen(null)
          }}
        />
      )}
    </div>
  )
}
