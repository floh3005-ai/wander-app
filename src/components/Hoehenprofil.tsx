import { useEffect, useMemo, useRef, useState } from 'react'
import { kumuliert } from '../lib/geo'
import { strecken, stufe } from '../lib/schwierigkeit'
import type { Punkt } from '../lib/typen'

interface Props {
  punkte: Punkt[]
  onHover: (p: Punkt | null) => void
}

const RAND = { links: 46, rechts: 12, oben: 12, unten: 22 }

function schoenerSchritt(spanne: number, ziel: number): number {
  const roh = spanne / ziel
  const potenz = 10 ** Math.floor(Math.log10(roh))
  const n = roh / potenz
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * potenz
}

export default function Hoehenprofil({ punkte, onHover }: Props) {
  const rahmen = useRef<HTMLDivElement>(null)
  const [breite, setBreite] = useState(600)
  const [zeiger, setZeiger] = useState<number | null>(null)
  const hoehe = 150

  useEffect(() => {
    const el = rahmen.current
    if (!el) return
    const ro = new ResizeObserver(() => setBreite(el.clientWidth))
    ro.observe(el)
    setBreite(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const daten = useMemo(() => {
    const strecke = kumuliert(punkte)
    const gesamt = strecke[strecke.length - 1] ?? 0
    let min = Infinity
    let max = -Infinity
    for (const p of punkte) {
      if (!Number.isFinite(p[2])) continue
      if (p[2] < min) min = p[2]
      if (p[2] > max) max = p[2]
    }
    return { strecke, gesamt, min, max }
  }, [punkte])

  if (punkte.length < 2 || !Number.isFinite(daten.min) || daten.gesamt === 0) {
    return (
      <div ref={rahmen} className="profil profil-leer">
        Das Höhenprofil erscheint, sobald Deine Tour zwei Punkte hat.
      </div>
    )
  }

  const innenB = Math.max(50, breite - RAND.links - RAND.rechts)
  const innenH = hoehe - RAND.oben - RAND.unten
  const spanne = Math.max(40, daten.max - daten.min)
  const unten = daten.min - spanne * 0.08
  const oben = daten.min + spanne * 1.08
  const x = (m: number) => RAND.links + (m / daten.gesamt) * innenB
  const y = (h: number) => RAND.oben + (1 - (h - unten) / (oben - unten)) * innenH

  let linie = ''
  let erster = -1
  let letzter = -1
  punkte.forEach((p, i) => {
    if (!Number.isFinite(p[2])) return
    linie += `${erster < 0 ? 'M' : 'L'}${x(daten.strecke[i]).toFixed(1)},${y(p[2]).toFixed(1)}`
    if (erster < 0) erster = i
    letzter = i
  })
  const boden = RAND.oben + innenH
  const flaeche = `${linie}L${x(daten.strecke[letzter]).toFixed(1)},${boden}L${x(daten.strecke[erster]).toFixed(1)},${boden}Z`

  const hSchritt = schoenerSchritt(oben - unten, 3)
  const hMarken: number[] = []
  for (let h = Math.ceil(unten / hSchritt) * hSchritt; h <= oben; h += hSchritt) hMarken.push(h)
  const kmSchritt = schoenerSchritt(daten.gesamt / 1000, Math.max(3, Math.floor(innenB / 90)))
  const kmMarken: number[] = []
  for (let k = 0; k <= daten.gesamt / 1000 + 1e-9; k += kmSchritt) kmMarken.push(k)

  function bewegt(ev: React.PointerEvent<SVGSVGElement>) {
    const box = ev.currentTarget.getBoundingClientRect()
    const meter = ((ev.clientX - box.left - RAND.links) / innenB) * daten.gesamt
    if (meter < 0 || meter > daten.gesamt) {
      verlassen()
      return
    }
    // binäre Suche nach dem nächsten Punkt
    let lo = 0
    let hi = daten.strecke.length - 1
    while (hi - lo > 1) {
      const mitte = (lo + hi) >> 1
      if (daten.strecke[mitte] < meter) lo = mitte
      else hi = mitte
    }
    const i = meter - daten.strecke[lo] < daten.strecke[hi] - meter ? lo : hi
    setZeiger(i)
    onHover(punkte[i])
  }

  function verlassen() {
    setZeiger(null)
    onHover(null)
  }

  const zp = zeiger !== null ? punkte[zeiger] : null

  return (
    <div ref={rahmen} className="profil">
      <svg
        width={breite}
        height={hoehe}
        onPointerMove={bewegt}
        onPointerLeave={verlassen}
        role="img"
        aria-label="Höhenprofil der Tour"
      >
        {hMarken.map((h) => (
          <g key={h}>
            <line className="profil-gitter" x1={RAND.links} x2={RAND.links + innenB} y1={y(h)} y2={y(h)} />
            <text className="profil-text" x={RAND.links - 6} y={y(h) + 4} textAnchor="end">
              {Math.round(h)} m
            </text>
          </g>
        ))}
        {kmMarken.map((k) => (
          <text key={k} className="profil-text" x={x(k * 1000)} y={hoehe - 6} textAnchor="middle">
            {k.toLocaleString('de-DE')} km
          </text>
        ))}
        <path className="profil-flaeche" d={flaeche} />
        {strecken(punkte).map((s) => {
          const art = stufe(s.code)
          if (!art) return null
          return (
            <rect
              key={s.von}
              x={x(s.vonM)}
              y={boden - 5}
              width={Math.max(1.5, x(s.bisM) - x(s.vonM))}
              height={5}
              fill={art.farbe}
            >
              <title>{art.titel + " (" + art.kurz + ")"}</title>
            </rect>
          )
        })}
        <path className="profil-linie" d={linie} />
        {zp && zeiger !== null && Number.isFinite(zp[2]) && (
          <g>
            <line
              className="profil-zeiger"
              x1={x(daten.strecke[zeiger])}
              x2={x(daten.strecke[zeiger])}
              y1={RAND.oben}
              y2={boden}
            />
            <circle className="profil-punkt" cx={x(daten.strecke[zeiger])} cy={y(zp[2])} r={4.5} />
          </g>
        )}
      </svg>
      {zp && zeiger !== null && Number.isFinite(zp[2]) && (
        <div className="profil-info">
          km {(daten.strecke[zeiger] / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ·{' '}
          {Math.round(zp[2])} m
        </div>
      )}
    </div>
  )
}
