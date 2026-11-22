import { useEffect, useMemo, useRef, useState } from 'react'
import Karte, { type Flug } from './components/Karte'
import Hoehenprofil from './components/Hoehenprofil'
import AmWeg from './components/AmWeg'
import Schwierigkeit from './components/Schwierigkeit'
import { umgedreht } from './lib/schwierigkeit'
import Konto, { type AbgleichStand } from './components/Konto'
import { abgleichen, zusammenfuehren } from './lib/abgleich'
import { cloud, cloudAblage, fehlerText } from './lib/cloud'
import Vorlagen from './components/Vorlagen'
import Wetter from './components/Wetter'
import { hoehenErgaenzen, hoehenFehlen } from './lib/hoehe'
import { sucheAmWeg } from './lib/orte'
import { alsTour, type Route } from './lib/vorlagen'
import { luftlinie, route } from './lib/brouter'
import {
  formatDauer,
  formatKm,
  gehzeitMinuten,
  hoehenmeter,
  kumuliert,
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
  return { punkte, meter, ...h, minuten: gehzeitMinuten(meter, h.auf, h.ab) }
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
  const [sichtbar, setSichtbar] = useState<Set<Kategorie>>(
    () => new Set<Kategorie>(['gipfel', 'aussicht', 'einkehr', 'schutz', 'burg', 'sehenswert', 'wasser']),
  )
  const [orteLaedt, setOrteLaedt] = useState(false)
  const [gewaehlterOrt, setGewaehlterOrt] = useState<{ nr: number; ort: Ort } | null>(null)
  const [vorschau, setVorschau] = useState<[number, number][] | null>(null)
  const ausschnitt = useRef<{ rahmen: [number, number, number, number]; zoom: number } | null>(null)
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
  const zahlen = useMemo(() => kennzahlen(aktiv), [aktiv])
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
    route(a, b)
      .then((punkte) => trageEin(a, b, punkte))
      .catch(() => {
        setMeldung(
          'Zwischen diesen Punkten wurde kein Weg gefunden – ich habe eine gerade Linie eingezeichnet. Setz den Punkt näher an einen Weg.',
        )
        trageEin(a, b, luftlinie(a, b))
      })
  }

  function punktDazu(lon: number, lat: number) {
    const neu: Wegpunkt = { lon, lat }
    const vorher = aktiv.wegpunkte[aktiv.wegpunkte.length - 1]
    aendere((t) => ({
      ...t,
      wegpunkte: [...t.wegpunkte, neu],
      abschnitte: t.wegpunkte.length > 0 ? [...t.abschnitte, null] : t.abschnitte,
    }))
    if (vorher) berechne(vorher, neu)
  }

  function punktVerschoben(i: number, lon: number, lat: number) {
    const neu: Wegpunkt = { lon, lat }
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
    const abschnitt = aktiv.abschnitte[nr]
    if (!abschnitt || abschnitt.length < 3) return
    const k = Math.min(abschnitt.length - 2, Math.max(1, naechsterIndex(abschnitt, lon, lat)))
    const neu: Wegpunkt = { lon: abschnitt[k][0], lat: abschnitt[k][1] }
    aendere((t) => {
      const wegpunkte = t.wegpunkte.slice()
      wegpunkte.splice(nr + 1, 0, neu)
      const abschnitte = t.abschnitte.slice()
      abschnitte.splice(nr, 1, abschnitt.slice(0, k + 1), abschnitt.slice(k))
      return { ...t, wegpunkte, abschnitte }
    })
  }

  function zurueckZumStart() {
    const erster = aktiv.wegpunkte[0]
    if (!erster || aktiv.wegpunkte.length < 2) return
    punktDazu(erster.lon, erster.lat)
  }

  function umkehren() {
    aendere((t) => ({
      ...t,
      wegpunkte: t.wegpunkte.slice().reverse(),
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
    if (!window.confirm(`Tour „${tour.name || 'Ohne Namen'}“ wirklich löschen?`)) return
    if (nichtLeer(tour)) {
      speichereGeloeschte({ ...ladeGeloeschte(), [tour.id]: new Date().toISOString() })
    }
    const rest = touren.filter((t) => t.id !== tour.id)
    if (tour.id === aktivId || rest.length === 0) {
      const t = neueTour()
      setTouren([t, ...rest.filter(nichtLeer)])
      setAktivId(t.id)
    } else {
      setTouren(rest)
    }
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

  return (
    <div className="app">
      <aside className="seite">
        <header className="kopf">
          <h1>Wander-App</h1>
          <span className="stufe">Tourenplaner</span>
        </header>

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
              <dt>Gehzeit</dt>
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

          <Schwierigkeit
            punkte={zahlen.punkte}
            onZeigen={(p) => fliege({ mitte: [p[0], p[1]], zoom: 15 })}
          />

          <p className="hinweis">
            {aktiv.wegpunkte.length === 0
              ? 'Klick auf die Karte, um den Startpunkt zu setzen.'
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
          <summary>Wanderrouten als Vorlage</summary>
          <Vorlagen
            ausschnitt={() => ausschnitt.current}
            onVorschau={routeVorschau}
            onUebernehmen={routeUebernehmen}
          />
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
                    <span className="tour-name">{t.name || 'Ohne Namen'}</span>
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
              Markierte Wanderwege
            </label>
          </div>
          {meldung && (
            <div className="meldung" role="status">
              {meldung}
            </div>
          )}
        </div>
        <Hoehenprofil punkte={zahlen.punkte} onHover={setHover} />
      </main>
    </div>
  )
}
