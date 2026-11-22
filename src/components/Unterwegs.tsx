import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import GipfelFinder from './GipfelFinder'
import Karte, { type Flug } from './Karte'
import WetterUnterwegs from './WetterUnterwegs'
import { fuehrungAus, hinweis as abbiegeText, meterText, stelleAufWeg } from '../lib/abbiegen'
import Statistik from './Statistik'
import { route } from '../lib/brouter'
import { loescheBild, merkeBild, nimmFoto } from '../lib/fotos'
import { entferneHinweis, vibriere, zeigeHinweis } from '../lib/signal'
import {
  alsTour,
  formatUhr,
  gehzeitJetzt,
  hoeheJetzt,
  inBewegung,
  ladeLauf,
  merkeLauf,
  neuerLauf,
  verarbeite,
  type Lauf,
} from '../lib/aufzeichnung'
import {
  formatDauer,
  formatKm,
  gehzeitMinuten,
  hoehenmeter,
  kumuliert,
  zusammensetzen,
} from '../lib/geo'
import { istApp, starteOrtung, type Ortung } from '../lib/standort'
import type { Punkt, Tour } from '../lib/typen'

interface Props {
  touren: Tour[]
  /** Anmelde-Kachel (Cloud-Status) */
  konto: ReactNode
  onSpeichern: (tour: Tour) => void
  onZumPlaner: () => void
}

/** Ab so vielen Metern neben dem Weg gilt die Route als verlassen */
const ABSEITS = 60

function neuerWegStand() {
  return {
    index: null as number | null,
    daneben: 0,
    /** Abbiegestellen, für die schon vibriert wurde (Ankündigung / jetzt) */
    angesagt: new Set<number>(),
    jetzt: new Set<number>(),
  }
}

interface Rest {
  meter: number
  minuten: number
  auf: number
  /** Abstand zur geplanten Route in Metern */
  daneben: number
}

function datumText(iso: string | number): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function Unterwegs({ touren, konto, onSpeichern, onZumPlaner }: Props) {
  const lauf = useRef<Lauf | null>(null)
  const beende = useRef<(() => void) | null>(null)
  const zuletztGemerkt = useRef(0)
  const eichung = useRef({ laeuft: false, versuch: 0 })
  const [, setStand] = useState(0)
  const neuZeichnen = () => setStand((n) => n + 1)
  const [aktiv, setAktiv] = useState(false)
  const [fertig, setFertig] = useState(false)
  const [name, setName] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [folgen, setFolgen] = useState(true)
  const [gipfelOffen, setGipfelOffen] = useState(false)
  const [fotoLaeuft, setFotoLaeuft] = useState(false)
  /** Abstecher: Route vom Standort zu einem angetippten Ziel */
  const [umweg, setUmweg] = useState<{ name: string; abschnitt: Punkt[] } | null>(null)
  const [zielFrage, setZielFrage] = useState<{ name: string; lon: number; lat: number } | null>(null)
  const [zielLaedt, setZielLaedt] = useState(false)
  const [flug, setFlug] = useState<Flug | null>(null)
  const flugNr = useRef(0)

  const geplant = touren.filter((t) => !t.aufzeichnung && t.wegpunkte.length >= 2)
  const gewandert = touren
    .filter((t) => t.aufzeichnung)
    .sort((a, b) => (a.aufzeichnung!.beginn < b.aufzeichnung!.beginn ? 1 : -1))

  const tour = lauf.current?.tourId ? touren.find((t) => t.id === lauf.current!.tourId) : undefined
  // Weg der geplanten Tour samt Abbiegestellen
  const fuehrung = useMemo(
    () => (umweg ? fuehrungAus([umweg.abschnitt]) : tour ? fuehrungAus(tour.abschnitte) : null),
    [tour, umweg],
  )
  const fuehrungJetzt = useRef(fuehrung)
  fuehrungJetzt.current = fuehrung
  const wegStand = useRef(neuerWegStand())

  // ---------- Ortung ----------

  function standort(o: Ortung) {
    const l = lauf.current
    if (!l) return
    const neu = verarbeite(l, o)
    fuehre(l, o)
    eichen(l, o)
    const jetzt = Date.now()
    if (neu && jetzt - zuletztGemerkt.current > 15_000) {
      merkeLauf(l)
      zuletztGemerkt.current = jetzt
    }
    neuZeichnen()
  }

  /**
   * Geplanter Tour folgen: merken, wo auf dem Weg man ist, und rechtzeitig vor
   * einer Abbiegung vibrieren – auch wenn das Handy in der Tasche steckt.
   */
  function fuehre(l: Lauf, o: Ortung) {
    const f = fuehrungJetzt.current
    if (!f || f.punkte.length < 2 || l.pausiert || o.genau > 35) return
    const s = wegStand.current
    const stelle = stelleAufWeg(f, o.lon, o.lat, s.index)
    s.index = stelle.index
    s.daneben = stelle.daneben
    // Neben der Route: bewusst kein Alarm – vielleicht ist es ein gewollter Abstecher.
    // Die Hinweise pausieren einfach, bis man wieder auf dem Weg ist.
    if (stelle.daneben > ABSEITS) return

    const naechste = f.liste.find((a) => a.meter >= f.meter[stelle.index] - 8)
    if (!naechste) return
    const bis = naechste.meter - f.meter[stelle.index]
    const h = abbiegeText(naechste.winkel)
    if (bis <= 25) {
      if (!s.jetzt.has(naechste.index)) {
        s.jetzt.add(naechste.index)
        s.angesagt.add(naechste.index)
        vibriere(900)
        zeigeHinweis(`${h.pfeil} Jetzt ${h.text}`, 'Wander-App')
      }
    } else if (bis <= 90 && !s.angesagt.has(naechste.index)) {
      s.angesagt.add(naechste.index)
      vibriere(400)
      zeigeHinweis(`${h.pfeil} In ${meterText(bis)} ${h.text}`, 'Wander-App')
    }
  }

  /** Vom Standort zu einem Ziel routen (Alm, Gasthaus, beliebiger Punkt auf der Karte). */
  async function routeZum(ziel: { name: string; lon: number; lat: number }) {
    const ich = lauf.current?.letzte
    if (!ich) {
      setFehler('Dein Standort ist noch nicht bekannt.')
      return
    }
    setZielLaedt(true)
    setFehler(null)
    try {
      const abschnitt = await route({ lon: ich.lon, lat: ich.lat }, { lon: ziel.lon, lat: ziel.lat })
      wegStand.current = neuerWegStand()
      setUmweg({ name: ziel.name, abschnitt })
      setZielFrage(null)
      let w = Infinity
      let s = Infinity
      let o = -Infinity
      let n = -Infinity
      for (const p of abschnitt) {
        if (p[0] < w) w = p[0]
        if (p[0] > o) o = p[0]
        if (p[1] < s) s = p[1]
        if (p[1] > n) n = p[1]
      }
      setFolgen(false)
      flugNr.current += 1
      setFlug({ nr: flugNr.current, rahmen: [w, s, o, n] })
    } catch {
      setFehler('Dorthin wurde kein Weg gefunden – oder es fehlt gerade das Netz.')
    }
    setZielLaedt(false)
  }

  function umwegEnde() {
    wegStand.current = neuerWegStand()
    setUmweg(null)
  }

  /**
   * GPS-Höhen liegen in Mitteleuropa rund 45–50 m neben den Kartenhöhen.
   * Einmal mit dem Geländemodell vergleichen und den Unterschied merken.
   */
  function eichen(l: Lauf, o: Ortung) {
    const e = eichung.current
    if (l.versatz !== null || o.hoehe === null || o.genau > 20 || e.laeuft) return
    if (Date.now() - e.versuch < 60_000) return
    e.laeuft = true
    e.versuch = Date.now()
    fetch(`https://api.open-meteo.com/v1/elevation?latitude=${o.lat.toFixed(5)}&longitude=${o.lon.toFixed(5)}`)
      .then((r) => r.json())
      .then((d) => {
        const gelaende = d?.elevation?.[0]
        if (typeof gelaende === 'number' && lauf.current === l) {
          l.versatz = o.hoehe! - gelaende
          merkeLauf(l)
          neuZeichnen()
        }
      })
      .catch(() => {})
      .finally(() => {
        e.laeuft = false
      })
  }

  async function ortungAn() {
    setFehler(null)
    beende.current?.()
    beende.current = await starteOrtung(standort, setFehler)
    setAktiv(true)
  }

  function ortungAus() {
    beende.current?.()
    beende.current = null
    setAktiv(false)
  }

  // Unterbrochene Aufzeichnung (App wurde geschlossen) wieder aufnehmen
  useEffect(() => {
    const gemerkt = ladeLauf()
    if (gemerkt) {
      lauf.current = gemerkt
      gemerkt.neuAnsetzen = true
      ortungAn()
    }
    return () => beende.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Uhr: jede Sekunde neu zeichnen, solange aufgezeichnet wird
  useEffect(() => {
    if (!aktiv) return
    const takt = setInterval(neuZeichnen, 1000)
    return () => clearInterval(takt)
  }, [aktiv])

  // Im Browser den Bildschirm wach halten (die Handy-App braucht das nicht)
  useEffect(() => {
    if (!aktiv || istApp || !('wakeLock' in navigator)) return
    let sperre: WakeLockSentinel | null = null
    const holen = () => {
      navigator.wakeLock
        .request('screen')
        .then((s) => (sperre = s))
        .catch(() => {})
    }
    holen()
    const beiRueckkehr = () => {
      if (document.visibilityState === 'visible') holen()
    }
    document.addEventListener('visibilitychange', beiRueckkehr)
    return () => {
      document.removeEventListener('visibilitychange', beiRueckkehr)
      sperre?.release().catch(() => {})
    }
  }, [aktiv])

  // ---------- Bedienung ----------

  function starten(t?: Tour) {
    lauf.current = neuerLauf(t?.id)
    wegStand.current = neuerWegStand()
    setUmweg(null)
    setZielFrage(null)
    eichung.current = { laeuft: false, versuch: 0 }
    merkeLauf(lauf.current)
    setFertig(false)
    setHinweis(null)
    setFolgen(true)
    if (t) {
      const p = zusammensetzen(t.abschnitte)
      let w = Infinity
      let s = Infinity
      let o = -Infinity
      let n = -Infinity
      for (const q of p) {
        if (q[0] < w) w = q[0]
        if (q[0] > o) o = q[0]
        if (q[1] < s) s = q[1]
        if (q[1] > n) n = q[1]
      }
      flugNr.current += 1
      setFlug({ nr: flugNr.current, rahmen: [w, s, o, n] })
    }
    ortungAn()
  }

  function pause() {
    const l = lauf.current
    if (!l) return
    l.pausiert = !l.pausiert
    merkeLauf(l)
    neuZeichnen()
  }

  function beenden() {
    const l = lauf.current
    if (!l) return
    ortungAus()
    entferneHinweis()
    merkeLauf(l)
    if (l.punkte.length < 2) {
      lauf.current = null
      merkeLauf(null)
      setHinweis('Es wurde noch keine Strecke aufgezeichnet – nichts gespeichert.')
      neuZeichnen()
      return
    }
    setName(tour?.name || `Wanderung am ${datumText(l.beginn)}`)
    setFertig(true)
  }

  function speichern() {
    const l = lauf.current
    if (!l) return
    onSpeichern(alsTour(l, name.trim() || `Wanderung am ${datumText(l.beginn)}`))
    lauf.current = null
    merkeLauf(null)
    setFertig(false)
    setHinweis('Deine Wanderung ist gespeichert.')
  }

  /** Ein Bild an die laufende Wanderung hängen (mit Standort). */
  async function haengeFotoAn(bild: Blob) {
    const l = lauf.current
    if (!l) return
    const id = crypto.randomUUID()
    await merkeBild(id, bild)
    l.fotos = [...(l.fotos ?? []), { id, zeit: new Date().toISOString(), lon: l.letzte?.lon, lat: l.letzte?.lat }]
    merkeLauf(l)
    neuZeichnen()
  }

  /** Foto aufnehmen und an die laufende Wanderung hängen (mit Standort). */
  async function foto() {
    const l = lauf.current
    if (!l || fotoLaeuft) return
    setFotoLaeuft(true)
    try {
      const bild = await nimmFoto()
      if (bild && lauf.current === l) await haengeFotoAn(bild)
    } catch {
      setFehler('Das Foto konnte nicht gespeichert werden.')
    }
    setFotoLaeuft(false)
  }

  function verwerfen() {
    if (!window.confirm('Aufzeichnung wirklich verwerfen? Sie ist dann weg.')) return
    for (const f of lauf.current?.fotos ?? []) loescheBild(f.id).catch(() => {})
    lauf.current = null
    merkeLauf(null)
    setFertig(false)
    setHinweis(null)
  }

  function weiter() {
    setFertig(false)
    if (lauf.current) lauf.current.neuAnsetzen = true
    ortungAn()
  }

  // ---------- Startseite ----------

  const l = lauf.current
  if (!l) {
    return (
      <div className="uw uw-start">
        <header className="uw-kopf">
          <h1>Wander-App</h1>
          <button type="button" onClick={onZumPlaner}>
            Zum Planer
          </button>
        </header>
        {konto}
        {hinweis && <p className="uw-hinweis">{hinweis}</p>}

        <button type="button" className="uw-gross haupt" onClick={() => starten()}>
          🥾 Frei aufzeichnen
          <span>Einfach loslaufen – ohne geplante Tour</span>
        </button>

        <button type="button" className="uw-gipfel-knopf" onClick={() => setGipfelOffen(true)}>
          ⛰️ Gipfel-Finder
          <span>Welche Berge sind rundum zu sehen?</span>
        </button>
        {gipfelOffen && <GipfelFinder position={null} onSchliessen={() => setGipfelOffen(false)} />}

        {!istApp && (
          <p className="uw-app-hinweis">
            Im Browser läuft die Aufzeichnung nur, solange der Bildschirm an ist.{' '}
            <a href="https://github.com/floh3005-ai/wander-app/releases/download/aktuell/wander-app.apk">
              Handy-App für Android herunterladen
            </a>
          </p>
        )}

        <section className="uw-block">
          <h2>Geplante Touren</h2>
          {geplant.length === 0 ? (
            <p className="leise">
              Noch keine Tour geplant. Plane am PC – nach dem Anmelden erscheint sie hier von selbst.
            </p>
          ) : (
            <ul className="uw-liste">
              {geplant.map((t) => {
                const p = zusammensetzen(t.abschnitte)
                const m = kumuliert(p)
                const h = hoehenmeter(p)
                const meter = m[m.length - 1] ?? 0
                return (
                  <li key={t.id}>
                    <div>
                      <strong>{t.name || 'Ohne Namen'}</strong>
                      <span>
                        {formatKm(meter)} km · {Math.round(h.auf)} m bergauf ·{' '}
                        {formatDauer(gehzeitMinuten(meter, h.auf, h.ab))}
                      </span>
                    </div>
                    <button type="button" className="haupt" onClick={() => starten(t)}>
                      Starten
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="uw-block uw-gewandert">
          <h2>Meine Wanderungen</h2>
          {gewandert.length > 0 && <Statistik touren={gewandert} />}
          {gewandert.length === 0 ? (
            <p className="leise">Hier erscheinen Deine aufgezeichneten Wanderungen.</p>
          ) : (
            <ul className="uw-liste">
              {gewandert.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t.name}</strong>
                    <span>
                      {datumText(t.aufzeichnung!.beginn)} · {formatKm(t.aufzeichnung!.meter)} km ·{' '}
                      {t.aufzeichnung!.auf} m bergauf · {formatDauer(t.aufzeichnung!.gehzeit / 60)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    )
  }

  // ---------- Während der Wanderung ----------

  const jetzt = Date.now()
  const bewegt = inBewegung(l, jetzt)
  const hoehe = hoeheJetzt(l)
  const spur = l.punkte.map((p) => [p[0], p[1]] as [number, number])
  const position = l.letzte ? { lon: l.letzte.lon, lat: l.letzte.lat } : null

  let rest: Rest | null = null
  let abbiegen: { pfeil: string; oben: string; unten: string } | null = null
  let abseits = 0
  if (fuehrung && fuehrung.punkte.length > 1 && l.letzte) {
    const stand = wegStand.current
    const stelle =
      stand.index !== null
        ? { index: stand.index, daneben: stand.daneben }
        : stelleAufWeg(fuehrung, l.letzte.lon, l.letzte.lat, null)
    const i = stelle.index
    const h = hoehenmeter(fuehrung.punkte.slice(i))
    const meter = fuehrung.meter[fuehrung.meter.length - 1] - fuehrung.meter[i]
    rest = { meter, minuten: gehzeitMinuten(meter, h.auf, h.ab), auf: h.auf, daneben: stelle.daneben }

    const naechste = fuehrung.liste.find((a) => a.meter >= fuehrung.meter[i] - 8)
    if (stelle.daneben > ABSEITS) {
      abseits = stelle.daneben
    } else if (!naechste) {
      abbiegen = { pfeil: '🏁', oben: `Noch ${meterText(meter)}`, unten: 'dem Weg bis zum Ziel folgen' }
    } else {
      const bis = naechste.meter - fuehrung.meter[i]
      const hw = abbiegeText(naechste.winkel)
      if (bis <= 25) abbiegen = { pfeil: hw.pfeil, oben: 'Jetzt', unten: hw.text }
      else if (bis <= 400) abbiegen = { pfeil: hw.pfeil, oben: `In ${meterText(bis)}`, unten: hw.text }
      else abbiegen = { pfeil: '↑', oben: meterText(bis), unten: 'dem Weg folgen' }
    }
  }

  const zustand = fertig
    ? 'Beendet'
    : l.pausiert
      ? 'Pausiert'
      : l.punkte.length === 0
        ? 'Warte auf GPS …'
        : bewegt
          ? 'In Bewegung'
          : 'Pause (automatisch)'

  return (
    <div className="uw uw-laeuft">
      <div className="uw-karte">
        <Karte
          wegpunkte={
            umweg
              ? [
                  { lon: umweg.abschnitt[0][0], lat: umweg.abschnitt[0][1] },
                  {
                    lon: umweg.abschnitt[umweg.abschnitt.length - 1][0],
                    lat: umweg.abschnitt[umweg.abschnitt.length - 1][1],
                  },
                ]
              : tour
                ? [tour.wegpunkte[0], tour.wegpunkte[tour.wegpunkte.length - 1]]
                : []
          }
          abschnitte={umweg ? [umweg.abschnitt] : tour ? tour.abschnitte : []}
          hover={null}
          flug={flug}
          basis="topo"
          wanderwege={false}
          orte={tour?.orte ?? []}
          gewaehlterOrt={null}
          vorschau={null}
          fest
          spur={spur}
          position={position}
          folgen={folgen}
          onVonHandBewegt={() => setFolgen(false)}
          onAusschnitt={() => {}}
          onKarteKlick={(lon, lat) => {
            if (!fertig) setZielFrage({ name: 'Punkt auf der Karte', lon, lat })
          }}
          onOrt={(o) => {
            if (!fertig) setZielFrage({ name: o.name, lon: o.lon, lat: o.lat })
          }}
          onLinieKlick={() => {}}
          onVerschoben={() => {}}
          onEntfernen={() => {}}
        />
        {abbiegen && !fertig && (
          <div className="uw-abbiegen" role="status">
            <span className="uw-pfeil" aria-hidden="true">
              {abbiegen.pfeil}
            </span>
            <span className="uw-abbiegen-text">
              <strong>{abbiegen.oben}</strong>
              <span>
                {abbiegen.unten}
                {fuehrung && !fuehrung.genau ? ' (geschätzt)' : ''}
              </span>
            </span>
          </div>
        )}
        <div className={`uw-zustand ${abbiegen && !fertig ? 'uw-zustand-unten' : ''} ${bewegt && !l.pausiert && !fertig ? 'an' : ''}`}>
          {zustand}
        </div>
        {abseits > 0 && !fertig && (
          <div className="uw-daneben">abseits der Route · {meterText(abseits)}</div>
        )}
        {!folgen && position && (
          <button type="button" className="uw-zentrieren haupt" onClick={() => setFolgen(true)}>
            Zu mir
          </button>
        )}
      </div>

      <div className="uw-unten">
        {fehler && <p className="warnung">{fehler}</p>}
        {zielFrage && !fertig && (
          <div className="uw-ziel">
            <p>
              <strong>{zielFrage.name}</strong>
              <br />
              Route von hier dorthin berechnen?
            </p>
            <div className="uw-knoepfe">
              <button type="button" className="haupt" disabled={zielLaedt} onClick={() => routeZum(zielFrage)}>
                {zielLaedt ? 'Rechne …' : 'Route dorthin'}
              </button>
              <button type="button" onClick={() => setZielFrage(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
        {umweg && !fertig && (
          <p className="uw-umweg">
            <span>
              Unterwegs zu <strong>{umweg.name}</strong>
            </span>
            <button type="button" onClick={umwegEnde}>
              {tour ? 'Zurück zur Tour' : 'Route beenden'}
            </button>
          </p>
        )}

        <dl className="uw-zahlen">
          <div>
            <dt>Gehzeit</dt>
            <dd>{formatUhr(gehzeitJetzt(l, jetzt))}</dd>
          </div>
          <div>
            <dt>Strecke</dt>
            <dd>{formatKm(l.meter)} km</dd>
          </div>
          <div>
            <dt>Höhe</dt>
            <dd>{hoehe !== null ? `${Math.round(hoehe)} m` : '–'}</dd>
          </div>
          <div>
            <dt>Bergauf</dt>
            <dd>{Math.round(l.auf)} m</dd>
          </div>
          <div>
            <dt>Bergab</dt>
            <dd>{Math.round(l.ab)} m</dd>
          </div>
          <div>
            <dt>{rest ? 'Noch' : 'Unterwegs seit'}</dt>
            <dd>
              {rest
                ? `${formatKm(rest.meter)} km`
                : new Date(l.beginn).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </dd>
          </div>
        </dl>
        {rest && !fertig && (
          <p className="uw-rest">
            Noch ca. {formatDauer(rest.minuten)} Gehzeit und {Math.round(rest.auf)} m bergauf bis zum Ziel
          </p>
        )}
        {l.letzte && !fertig && (
          <WetterUnterwegs
            lon={l.letzte.lon}
            lat={l.letzte.lat}
            hoehe={l.versatz !== null ? hoehe : null}
            stunden={rest ? rest.minuten / 60 : 3}
          />
        )}
        {hoehe !== null && l.versatz === null && (
          <p className="leise">Höhe noch ungeeicht (GPS-Rohwert) – wird berichtigt, sobald Netz da ist.</p>
        )}

        {fertig && (
          <div className="uw-fertig">
            <label className="feld">
              <span>Name der Wanderung</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="uw-knoepfe">
              <button type="button" className="haupt" onClick={speichern}>
                Speichern
              </button>
              <button type="button" onClick={weiter}>
                Weiter aufzeichnen
              </button>
              <button type="button" onClick={verwerfen}>
                Verwerfen
              </button>
            </div>
          </div>
        )}
        {fertig ? null : (
          <div className="uw-knoepfe uw-werkzeug">
            <button type="button" disabled={fotoLaeuft} onClick={foto}>
              📷 Foto{l.fotos?.length ? ` (${l.fotos.length})` : ''}
            </button>
            <button type="button" onClick={() => setGipfelOffen(true)}>
              ⛰️ Gipfel
            </button>
            <button
              type="button"
              disabled={zielLaedt || l.punkte.length === 0}
              onClick={() => routeZum({ name: 'Startpunkt', lon: l.punkte[0][0], lat: l.punkte[0][1] })}
            >
              🏠 Zum Start
            </button>
          </div>
        )}
        {fertig ? null : (
          <div className="uw-knoepfe">
            <button type="button" onClick={pause}>
              {l.pausiert ? '▶ Weiter' : '⏸ Pause'}
            </button>
            <button type="button" className="haupt" onClick={beenden}>
              ⏹ Beenden
            </button>
          </div>
        )}
      </div>
      {gipfelOffen && (
        <GipfelFinder
          position={position}
          hoehe={l.versatz !== null ? hoehe : null}
          onSchliessen={() => setGipfelOffen(false)}
          onFoto={fertig ? undefined : haengeFotoAn}
        />
      )}
    </div>
  )
}
