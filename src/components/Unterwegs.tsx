import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Karte, { type Flug } from './Karte'
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
  entfernung,
  formatDauer,
  formatKm,
  gehzeitMinuten,
  hoehenmeter,
  kumuliert,
  naechsterIndex,
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
  const [flug, setFlug] = useState<Flug | null>(null)
  const flugNr = useRef(0)

  const geplant = touren.filter((t) => !t.aufzeichnung && t.wegpunkte.length >= 2)
  const gewandert = touren
    .filter((t) => t.aufzeichnung)
    .sort((a, b) => (a.aufzeichnung!.beginn < b.aufzeichnung!.beginn ? 1 : -1))

  const tour = lauf.current?.tourId ? touren.find((t) => t.id === lauf.current!.tourId) : undefined
  const route = useMemo(() => (tour ? zusammensetzen(tour.abschnitte) : []), [tour])
  const routeMeter = useMemo(() => kumuliert(route), [route])

  // ---------- Ortung ----------

  function standort(o: Ortung) {
    const l = lauf.current
    if (!l) return
    const neu = verarbeite(l, o)
    eichen(l, o)
    const jetzt = Date.now()
    if (neu && jetzt - zuletztGemerkt.current > 15_000) {
      merkeLauf(l)
      zuletztGemerkt.current = jetzt
    }
    neuZeichnen()
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

  function verwerfen() {
    if (!window.confirm('Aufzeichnung wirklich verwerfen? Sie ist dann weg.')) return
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
  if (tour && route.length > 1 && l.letzte) {
    const i = naechsterIndex(route, l.letzte.lon, l.letzte.lat)
    const teil: Punkt[] = route.slice(i)
    const h = hoehenmeter(teil)
    const meter = routeMeter[routeMeter.length - 1] - routeMeter[i]
    rest = {
      meter,
      minuten: gehzeitMinuten(meter, h.auf, h.ab),
      auf: h.auf,
      daneben: entfernung(route[i][0], route[i][1], l.letzte.lon, l.letzte.lat),
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
          wegpunkte={tour ? [tour.wegpunkte[0], tour.wegpunkte[tour.wegpunkte.length - 1]] : []}
          abschnitte={tour ? tour.abschnitte : []}
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
          onKarteKlick={() => {}}
          onLinieKlick={() => {}}
          onVerschoben={() => {}}
          onEntfernen={() => {}}
        />
        <div className={`uw-zustand ${bewegt && !l.pausiert && !fertig ? 'an' : ''}`}>{zustand}</div>
        {!folgen && position && (
          <button type="button" className="uw-zentrieren haupt" onClick={() => setFolgen(true)}>
            Zu mir
          </button>
        )}
      </div>

      <div className="uw-unten">
        {fehler && <p className="warnung">{fehler}</p>}
        {rest && rest.daneben > 80 && !fertig && (
          <p className="warnung">
            Du bist etwa {Math.round(rest.daneben / 10) * 10} m neben der geplanten Route.
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
        {hoehe !== null && l.versatz === null && (
          <p className="leise">Höhe noch ungeeicht (GPS-Rohwert) – wird berichtigt, sobald Netz da ist.</p>
        )}

        {fertig ? (
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
        ) : (
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
    </div>
  )
}
