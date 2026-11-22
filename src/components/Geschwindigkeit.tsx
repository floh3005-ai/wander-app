import { useEffect, useMemo, useRef, useState } from 'react'
import { entfernung, formatKm } from '../lib/geo'
import type { Punkt, Tour } from '../lib/typen'

interface Props {
  tour: Tour
  onHover: (p: Punkt | null) => void
}

const RAND = { links: 52, rechts: 14, oben: 14, unten: 24 }
/** Längere Abstände zwischen zwei Punkten gelten als Pause (wie bei der Aufzeichnung) */
const LUECKE = 45

function uhr(sekunden: number): string {
  const s = Math.round(sekunden)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} Std`
}

function kmh(meter: number, sekunden: number): string {
  if (sekunden <= 0) return '–'
  return `${((meter / sekunden) * 3.6).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km/h`
}

/** Geschwindigkeitsprofil einer aufgezeichneten Wanderung. */
export default function Geschwindigkeit({ tour, onHover }: Props) {
  const rahmen = useRef<HTMLDivElement>(null)
  const [breite, setBreite] = useState(600)
  const [zeiger, setZeiger] = useState<number | null>(null)
  const [auswahl, setAuswahl] = useState<[number, number] | null>(null)
  const zieht = useRef<number | null>(null)
  const hoehe = 190

  useEffect(() => {
    const el = rahmen.current
    if (!el) return
    const ro = new ResizeObserver(() => setBreite(el.clientWidth))
    ro.observe(el)
    setBreite(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => setAuswahl(null), [tour.id])

  const a = tour.aufzeichnung
  const punkte = tour.abschnitte[0] ?? []
  const zeiten = a?.zeiten

  const d = useMemo(() => {
    if (!zeiten || zeiten.length !== punkte.length || punkte.length < 3) return null
    // Bewegungszeit und Strecke bis zu jedem Punkt
    const bewegt: number[] = [0]
    const meter: number[] = [0]
    for (let i = 1; i < punkte.length; i++) {
      const weg = entfernung(punkte[i - 1][0], punkte[i - 1][1], punkte[i][0], punkte[i][1])
      const dt = zeiten[i] - zeiten[i - 1]
      bewegt.push(bewegt[i - 1] + (dt <= LUECKE ? Math.max(0, dt) : Math.min(dt, weg / 0.9)))
      meter.push(meter[i - 1] + weg)
    }
    // Tempo je Punkt, über gut eine Minute geglättet
    const tempo: number[] = punkte.map((_, i) => {
      let von = i
      let bis = i
      while (von > 0 && bewegt[i] - bewegt[von] < 35) von--
      while (bis < punkte.length - 1 && bewegt[bis] - bewegt[i] < 35) bis++
      const zeit = bewegt[bis] - bewegt[von]
      return zeit > 0 ? ((meter[bis] - meter[von]) / zeit) * 3.6 : 0
    })
    let hMin = Infinity
    let hMax = -Infinity
    for (const p of punkte) {
      if (!Number.isFinite(p[2])) continue
      if (p[2] < hMin) hMin = p[2]
      if (p[2] > hMax) hMax = p[2]
    }
    return { bewegt, meter, tempo, hMin, hMax, gesamt: bewegt[bewegt.length - 1], vMax: Math.max(...tempo) }
  }, [punkte, zeiten])

  if (!a) return null
  if (!d) {
    return (
      <div ref={rahmen} className="tempo-profil tempo-profil-leer">
        Für diese Wanderung sind keine Zeitpunkte gespeichert – das Geschwindigkeitsprofil gibt es für alle
        Wanderungen, die ab jetzt aufgezeichnet werden.
      </div>
    )
  }

  const innenB = Math.max(60, breite - RAND.links - RAND.rechts)
  const innenH = hoehe - RAND.oben - RAND.unten
  const oben = Math.max(4, Math.ceil(d.vMax * 1.1))
  const x = (sek: number) => RAND.links + (sek / d.gesamt) * innenB
  const y = (v: number) => RAND.oben + (1 - v / oben) * innenH
  const yH = (h: number) => RAND.oben + (1 - (h - d.hMin) / Math.max(1, d.hMax - d.hMin)) * innenH * 0.9 + innenH * 0.05
  const boden = RAND.oben + innenH

  let flaeche = `M${x(0).toFixed(1)},${boden}`
  let hoehenLinie = ''
  punkte.forEach((p, i) => {
    flaeche += `L${x(d.bewegt[i]).toFixed(1)},${y(d.tempo[i]).toFixed(1)}`
    if (Number.isFinite(p[2])) {
      hoehenLinie += `${hoehenLinie ? 'L' : 'M'}${x(d.bewegt[i]).toFixed(1)},${yH(p[2]).toFixed(1)}`
    }
  })
  flaeche += `L${x(d.gesamt).toFixed(1)},${boden}Z`

  const vMarken = [0, oben / 3, (oben * 2) / 3, oben]
  const tMarken = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => t * d.gesamt)

  function stelle(ev: React.PointerEvent<SVGSVGElement>): number {
    const box = ev.currentTarget.getBoundingClientRect()
    const sek = Math.min(d!.gesamt, Math.max(0, ((ev.clientX - box.left - RAND.links) / innenB) * d!.gesamt))
    let lo = 0
    let hi = d!.bewegt.length - 1
    while (hi - lo > 1) {
      const mitte = (lo + hi) >> 1
      if (d!.bewegt[mitte] < sek) lo = mitte
      else hi = mitte
    }
    return sek - d!.bewegt[lo] < d!.bewegt[hi] - sek ? lo : hi
  }

  function runter(ev: React.PointerEvent<SVGSVGElement>) {
    const i = stelle(ev)
    zieht.current = i
    setAuswahl(null)
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  function bewegtSich(ev: React.PointerEvent<SVGSVGElement>) {
    const i = stelle(ev)
    setZeiger(i)
    onHover(punkte[i])
    if (zieht.current !== null && Math.abs(i - zieht.current) > 1) {
      setAuswahl([Math.min(zieht.current, i), Math.max(zieht.current, i)])
    }
  }
  function hoch() {
    zieht.current = null
  }
  function weg() {
    if (zieht.current !== null) return
    setZeiger(null)
    onHover(null)
  }

  // Zahlen für die ganze Wanderung oder den markierten Bereich
  const [von, bis] = auswahl ?? [0, punkte.length - 1]
  const teilMeter = d.meter[bis] - d.meter[von]
  const teilBewegt = d.bewegt[bis] - d.bewegt[von]
  const teilGesamt = zeiten![bis] - zeiten![von]
  let teilAuf = 0
  let teilAb = 0
  let bezug: number | null = null
  for (let i = von; i <= bis; i++) {
    const h = punkte[i][2]
    if (!Number.isFinite(h)) continue
    if (bezug === null) bezug = h
    else if (h - bezug >= 6) {
      teilAuf += h - bezug
      bezug = h
    } else if (h - bezug <= -6) {
      teilAb += bezug - h
      bezug = h
    }
  }

  // Ohne Markierung dieselben Höhenmeter zeigen wie oben in der Tour-Kachel
  if (!auswahl) {
    teilAuf = a.auf
    teilAb = a.ab
  }

  return (
    <div ref={rahmen} className="tempo-profil">
      <div className="tempo-profil-kopf">
        <strong>Geschwindigkeitsprofil</strong>
        <span>
          {auswahl
            ? 'Markierter Bereich – klick ins Profil, um wieder alles zu sehen'
            : 'Mit gedrückter Maus über das Profil ziehen, um einen Bereich auszuwerten'}
        </span>
      </div>
      <svg
        width={breite}
        height={hoehe}
        onPointerDown={runter}
        onPointerMove={bewegtSich}
        onPointerUp={hoch}
        onPointerLeave={weg}
        role="img"
        aria-label="Geschwindigkeit über die Bewegungszeit"
      >
        {vMarken.map((v) => (
          <g key={v}>
            <line className="profil-gitter" x1={RAND.links} x2={RAND.links + innenB} y1={y(v)} y2={y(v)} />
            <text className="profil-text" x={RAND.links - 6} y={y(v) + 4} textAnchor="end">
              {v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km/h
            </text>
          </g>
        ))}
        {tMarken.map((t) => (
          <text key={t} className="profil-text" x={x(t)} y={hoehe - 7} textAnchor="middle">
            {uhr(t).replace(' Std', '')}
          </text>
        ))}
        {auswahl && (
          <rect
            className="tempo-auswahl"
            x={x(d.bewegt[von])}
            y={RAND.oben}
            width={Math.max(1, x(d.bewegt[bis]) - x(d.bewegt[von]))}
            height={innenH}
          />
        )}
        <path className="tempo-flaeche" d={flaeche} />
        <path className="tempo-hoehe" d={hoehenLinie} />
        {zeiger !== null && (
          <g>
            <line className="profil-zeiger" x1={x(d.bewegt[zeiger])} x2={x(d.bewegt[zeiger])} y1={RAND.oben} y2={boden} />
            <circle className="profil-punkt" cx={x(d.bewegt[zeiger])} cy={y(d.tempo[zeiger])} r={4.5} />
          </g>
        )}
      </svg>
      {zeiger !== null && (
        <div className="profil-info">
          {uhr(d.bewegt[zeiger])} · {d.tempo[zeiger].toLocaleString('de-DE', { maximumFractionDigits: 1 })} km/h
          {Number.isFinite(punkte[zeiger][2]) ? ` · ${Math.round(punkte[zeiger][2])} m` : ''}
        </div>
      )}
      <dl className="tempo-zahlen">
        <div>
          <dd>{kmh(teilMeter, teilBewegt)}</dd>
          <dt>Geschwindigkeit</dt>
        </div>
        <div>
          <dd>{uhr(teilBewegt)}</dd>
          <dt>Bewegungszeit</dt>
        </div>
        <div>
          <dd>{uhr(teilGesamt)}</dd>
          <dt>Gesamtzeit</dt>
        </div>
        <div>
          <dd>{formatKm(teilMeter)} km</dd>
          <dt>Strecke</dt>
        </div>
        <div>
          <dd>
            ↑ {Math.round(teilAuf)} m · ↓ {Math.round(teilAb)} m
          </dd>
          <dt>Anstieg · Abstieg</dt>
        </div>
      </dl>
    </div>
  )
}
