import { useEffect, useMemo, useRef, useState } from 'react'
import { formatKm } from '../lib/geo'
import { gipfelRundum, richtungText, winkelUnterschied, type Gipfel } from '../lib/gipfel'
import { starteKompass } from '../lib/kompass'
import { ladeGelaende, type Gelaende } from '../lib/gelaende'
import GipfelKamera from './GipfelKamera'
import { starteOrtung } from '../lib/standort'

interface Props {
  /** Standort, falls schon bekannt (laufende Aufzeichnung) */
  position: { lon: number; lat: number } | null
  /** Eigene Höhe über dem Meer, falls bekannt – sonst wird das Gelände gefragt */
  hoehe?: number | null
  onSchliessen: () => void
  /** Bild mit Namensschildern speichern (nur während einer Aufzeichnung) */
  onFoto?: (bild: Blob) => Promise<void>
}

const BLICKFELD = 70 // Grad, die im Panorama zu sehen sind
const ZEILEN = 6

export default function GipfelFinder({ position, hoehe: eigeneHoehe, onSchliessen, onFoto }: Props) {
  const [ansicht, setAnsicht] = useState<'kamera' | 'liste'>('kamera')
  // undefined = wird noch geladen, null = nicht verfügbar
  const [gelaende, setGelaende] = useState<Gelaende | null | undefined>(undefined)
  const [ort, setOrt] = useState(position)
  const [gipfel, setGipfel] = useState<Gipfel[] | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [blick, setBlick] = useState(0)
  const [kompass, setKompass] = useState<'warte' | 'ja' | 'nein'>('warte')
  const rahmen = useRef<HTMLDivElement>(null)
  const [breite, setBreite] = useState(360)
  const geladenFuer = useRef<{ lon: number; lat: number } | null>(null)

  // Standort übernehmen oder selbst bestimmen
  useEffect(() => {
    if (position) {
      setOrt(position)
      return
    }
    let stopp: (() => void) | null = null
    let fertig = false
    starteOrtung(
      (o) => {
        if (o.genau > 100) return
        setOrt({ lon: o.lon, lat: o.lat })
        stopp?.()
        fertig = true
      },
      setFehler,
    ).then((s) => {
      stopp = s
      if (fertig) s()
    })
    return () => stopp?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lon, position?.lat])

  // Gipfel laden – neu erst, wenn man gut 2 km weiter ist
  useEffect(() => {
    if (!ort) return
    const alt = geladenFuer.current
    if (alt && Math.abs(alt.lon - ort.lon) < 0.03 && Math.abs(alt.lat - ort.lat) < 0.02) return
    geladenFuer.current = ort
    gipfelRundum(ort.lon, ort.lat)
      .then(setGipfel)
      .catch(() => setFehler('Die Gipfeldaten konnten nicht geladen werden. Dafür ist Netz nötig.'))
    // Geländemodell für die Sichtprüfung (welche Gipfel sind verdeckt?)
    ladeGelaende(ort.lon, ort.lat)
      .then(setGelaende)
      .catch(() => setGelaende(null))
  }, [ort])

  // Augenhöhe: Gelände am Standort (oder die gemessene Höhe, falls höher) plus Körpergröße
  const augen = useMemo(() => {
    const boden = gelaende && ort ? gelaende.hoeheBei(ort.lon, ort.lat) : NaN
    const gemessen = eigeneHoehe ?? NaN
    if (!Number.isFinite(boden) && !Number.isFinite(gemessen)) return null
    return Math.max(Number.isFinite(boden) ? boden : -Infinity, Number.isFinite(gemessen) ? gemessen : -Infinity) + 1.6
  }, [gelaende, ort, eigeneHoehe])

  // Kompass
  useEffect(() => {
    let gemeldet = false
    const stopp = starteKompass((grad) => {
      gemeldet = true
      setKompass('ja')
      setBlick(grad)
    })
    const timer = setTimeout(() => {
      if (!gemeldet) setKompass('nein')
    }, 2000)
    return () => {
      stopp()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const el = rahmen.current
    if (!el) return
    const ro = new ResizeObserver(() => setBreite(el.clientWidth))
    ro.observe(el)
    setBreite(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Was liegt in Blickrichtung? Wichtige Gipfel (hoch und nah) bekommen zuerst einen Platz.
  const imBild = useMemo(() => {
    if (!gipfel) return []
    const kandidaten = gipfel
      .map((g) => ({ g, ab: winkelUnterschied(g.richtung, blick) }))
      .filter((k) => Math.abs(k.ab) <= BLICKFELD / 2)
      .sort((a, b) => (b.g.hoehe ?? 0) - b.g.meter / 25 - ((a.g.hoehe ?? 0) - a.g.meter / 25))
    const belegt: [number, number][][] = Array.from({ length: ZEILEN }, () => [])
    const out: { g: Gipfel; x: number; zeile: number }[] = []
    for (const k of kandidaten) {
      const x = (k.ab / BLICKFELD + 0.5) * breite
      // geschätzte halbe Breite der Beschriftung (Name fett, darunter Höhe und Entfernung)
      const halb = Math.max(k.g.name.length * 4.1, 48) + 6
      if (x - halb < 0 || x + halb > breite) continue // würde am Rand abgeschnitten
      for (let z = 0; z < ZEILEN; z++) {
        if (belegt[z].every(([a, b]) => x + halb < a || x - halb > b)) {
          belegt[z].push([x - halb, x + halb])
          out.push({ g: k.g, x, zeile: z })
          break
        }
      }
    }
    return out
  }, [gipfel, blick, breite])

  const liste = useMemo(() => {
    if (!gipfel) return []
    return gipfel
      .filter((g) => Math.abs(winkelUnterschied(g.richtung, blick)) <= BLICKFELD / 2)
      .slice(0, 14)
  }, [gipfel, blick])

  const marken: { grad: number; text: string; x: number }[] = []
  for (let grad = 0; grad < 360; grad += 15) {
    const ab = winkelUnterschied(grad, blick)
    if (Math.abs(ab) > BLICKFELD / 2) continue
    marken.push({ grad, text: grad % 45 === 0 ? richtungText(grad) : '', x: (ab / BLICKFELD + 0.5) * breite })
  }

  if (ansicht === 'kamera' && ort && gipfel && gelaende !== undefined && augen !== null) {
    return (
      <GipfelKamera
        ort={ort}
        hoehe={augen}
        gipfel={gipfel}
        gelaende={gelaende}
        onListe={() => setAnsicht('liste')}
        onSchliessen={onSchliessen}
        onFoto={onFoto}
      />
    )
  }

  const hoehe = 250
  return (
    <div className="gipfel" role="dialog" aria-label="Gipfel-Finder">
      <header className="gipfel-kopf">
        <h2>⛰️ Gipfel-Finder</h2>
        <div className="gipfel-kopf-knoepfe">
          {ansicht === 'liste' && (
            <button type="button" className="haupt" onClick={() => setAnsicht('kamera')}>
              📷 Kamera
            </button>
          )}
          <button type="button" onClick={onSchliessen}>
            Schließen
          </button>
        </div>
      </header>

      {fehler && <p className="warnung">{fehler}</p>}
      {!ort && !fehler && <p className="leise">Standort wird bestimmt …</p>}
      {ort && !gipfel && !fehler && <p className="leise">Gipfel werden geladen …</p>}

      <div ref={rahmen} className="gipfel-bild" style={{ height: hoehe }}>
        <svg width={breite} height={hoehe} role="img" aria-label="Gipfel in Blickrichtung">
          {marken.map((m) => (
            <g key={m.grad}>
              <line className="gipfel-strich" x1={m.x} x2={m.x} y1={hoehe - 26} y2={hoehe - (m.text ? 14 : 20)} />
              {m.text && (
                <text className="gipfel-himmel" x={m.x} y={hoehe - 2} textAnchor="middle">
                  {m.text}
                </text>
              )}
            </g>
          ))}
          <line className="gipfel-boden" x1={0} x2={breite} y1={hoehe - 26} y2={hoehe - 26} />
          {imBild.map(({ g, x, zeile }) => {
            const y = 16 + zeile * 34
            return (
              <g key={`${g.name}${g.lon}`}>
                <line className="gipfel-linie" x1={x} x2={x} y1={y + 18} y2={hoehe - 26} />
                <text className="gipfel-name" x={x} y={y} textAnchor="middle">
                  {g.name}
                </text>
                <text className="gipfel-wert" x={x} y={y + 13} textAnchor="middle">
                  {g.hoehe ? `${Math.round(g.hoehe)} m · ` : ''}
                  {formatKm(g.meter)} km
                </text>
              </g>
            )
          })}
          <line className="gipfel-mitte" x1={breite / 2} x2={breite / 2} y1={0} y2={hoehe - 26} />
        </svg>
      </div>

      <p className="gipfel-blick">
        Blickrichtung: <strong>{richtungText(blick)}</strong> ({Math.round(blick)}°)
      </p>
      {kompass === 'nein' && (
        <label className="gipfel-regler">
          <span>Dieses Gerät meldet keinen Kompass – Blickrichtung hier einstellen:</span>
          <input
            type="range"
            min={0}
            max={359}
            value={Math.round(blick)}
            onChange={(e) => setBlick(Number(e.target.value))}
          />
        </label>
      )}

      {gipfel && (
        <>
          {liste.length === 0 ? (
            <p className="leise">In dieser Richtung ist kein benannter Gipfel eingetragen.</p>
          ) : (
            <ul className="gipfel-liste">
              {liste.map((g) => (
                <li key={`${g.name}${g.lon}`}>
                  <strong>{g.name}</strong>
                  <span>
                    {g.hoehe ? `${Math.round(g.hoehe)} m · ` : ''}
                    {formatKm(g.meter)} km · {richtungText(g.richtung)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="leise">
            {gipfel.length} benannte Gipfel im Umkreis von 45 km. Angezeigt wird, was in der Richtung liegt –
            auch Gipfel, die von einem Berg davor verdeckt sind.
          </p>
        </>
      )}
    </div>
  )
}
