import { useEffect, useMemo, useRef, useState } from 'react'
import { formatKm } from '../lib/geo'
import { richtungText, type Gipfel } from '../lib/gipfel'
import { blickrichtung, drehungFuerBlick, projiziere, starteLage, type Drehung } from '../lib/lage'
import type { Gelaende } from '../lib/gelaende'
import { gipfelSchluessel, hoehenwinkel, istSichtbar } from '../lib/sicht'

interface Props {
  ort: { lon: number; lat: number }
  /** Augenhöhe über dem Meer */
  hoehe: number
  gipfel: Gipfel[]
  /** Geländemodell für die Sichtprüfung – null, wenn es nicht geladen werden konnte */
  gelaende: Gelaende | null
  onListe: () => void
  onSchliessen: () => void
  /** Bild mit Namensschildern an die laufende Wanderung hängen */
  onFoto?: (bild: Blob) => Promise<void>
}

interface Schild {
  g: Gipfel
  /** Gipfelhöhe (aus den Kartendaten oder dem Geländemodell) */
  gh: number
  x: number
  y: number
  /** Länge der Linie vom Gipfel hinauf zum Schild */
  linie: number
  geprueft: boolean
}

// Der Handy-Kompass zeigt zum magnetischen Nordpol; in Mitteleuropa liegt der
// rund 4° östlich von Karten-Nord.
const MISSWEISUNG = 4
const MERK = 'wander.gipfelkamera.v1'
const MAX_KANDIDATEN = 150
const MIN_ABSTAND = 34

function ladeFein(): { versatz: number; winkel: number } {
  try {
    return { versatz: 0, winkel: 66, ...JSON.parse(localStorage.getItem(MERK) ?? '{}') }
  } catch {
    return { versatz: 0, winkel: 66 }
  }
}

export default function GipfelKamera({ ort, hoehe, gipfel, gelaende, onListe, onSchliessen, onFoto }: Props) {
  const rahmen = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [groesse, setGroesse] = useState({ b: 360, h: 640 })
  const [bild, setBild] = useState<{ b: number; h: number } | null>(null)
  const [kamera, setKamera] = useState<'warte' | 'an' | 'aus'>('warte')
  const [sensor, setSensor] = useState<'warte' | 'ja' | 'nein'>('warte')
  const [drehung, setDrehung] = useState<Drehung>(() => drehungFuerBlick(0))
  const [blickVonHand, setBlickVonHand] = useState(180)
  const [fein, setFein] = useState(ladeFein)
  const [feinOffen, setFeinOffen] = useState(false)


  const [gewaehlt, setGewaehlt] = useState<Gipfel | null>(null)
  const [fotoStand, setFotoStand] = useState<'frei' | 'laeuft' | 'fertig'>('frei')
  const zug = useRef<{ x: number; versatz: number } | null>(null)

  // Größe der Ansicht
  useEffect(() => {
    const el = rahmen.current
    if (!el) return
    const messen = () => setGroesse({ b: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(messen)
    ro.observe(el)
    messen()
    return () => ro.disconnect()
  }, [])

  // Kamera
  useEffect(() => {
    let strom: MediaStream | null = null
    let aktuell = true
    if (!navigator.mediaDevices?.getUserMedia) {
      setKamera('aus')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (!aktuell) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        strom = s
        if (video.current) {
          video.current.srcObject = s
          video.current.play().catch(() => {})
        }
        setKamera('an')
      })
      .catch(() => aktuell && setKamera('aus'))
    return () => {
      aktuell = false
      strom?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Lage-Sensor
  useEffect(() => {
    let gemeldet = false
    let warten = 0
    let letzte: Drehung | null = null
    const stopp = starteLage((r) => {
      if (!gemeldet) {
        gemeldet = true
        setSensor('ja')
      }
      letzte = r
      if (!warten) {
        warten = requestAnimationFrame(() => {
          warten = 0
          if (letzte) setDrehung(letzte)
        })
      }
    })
    const timer = setTimeout(() => {
      if (!gemeldet) setSensor('nein')
    }, 2000)
    return () => {
      stopp()
      clearTimeout(timer)
      if (warten) cancelAnimationFrame(warten)
    }
  }, [])

  // Ohne Sensor (PC): Blickrichtung per Regler
  useEffect(() => {
    if (sensor === 'nein') setDrehung(drehungFuerBlick(blickVonHand, 14))
  }, [sensor, blickVonHand])

  useEffect(() => {
    try {
      localStorage.setItem(MERK, JSON.stringify(fein))
    } catch {
      // nicht schlimm
    }
  }, [fein])

  // Gipfel mit ihrem Winkel über dem Horizont – verdeckte fallen heraus,
  // die wichtigsten (hoch und nah) stehen vorn.
  const kandidaten = useMemo(() => {
    const out: { g: Gipfel; gh: number; winkel: number; rang: number }[] = []
    for (const g of gipfel) {
      // Fehlt die Höhe in den Kartendaten, hilft das Geländemodell aus
      const gh = g.hoehe ?? gelaende?.hoeheBei(g.lon, g.lat) ?? NaN
      if (!Number.isFinite(gh)) continue
      if (gelaende && !istSichtbar(gelaende, { ...ort, hoehe }, g, gh)) continue
      out.push({ g, gh, winkel: hoehenwinkel(hoehe, gh, g.meter), rang: gh - g.meter / 40 })
    }
    return out.sort((a, b) => b.rang - a.rang).slice(0, MAX_KANDIDATEN)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gipfel, gelaende, hoehe, ort.lon, ort.lat])

  // Brennweite in Bildpunkten: aus dem Bildwinkel der Kamera und der Vergrößerung auf dem Schirm
  const brennweite = useMemo(() => {
    const halb = Math.tan(((fein.winkel / 2) * Math.PI) / 180)
    if (!bild) return groesse.h / 2 / halb
    const vergroesserung = Math.max(groesse.b / bild.b, groesse.h / bild.h)
    return (Math.max(bild.b, bild.h) / 2 / halb) * vergroesserung
  }, [bild, groesse, fein.winkel])

  const korrektur = MISSWEISUNG + fein.versatz
  const schilder: Schild[] = []
  for (const k of kandidaten) {
    const p = projiziere(drehung, k.g.richtung - korrektur, k.winkel, brennweite, groesse.b / 2, groesse.h / 2)
    if (!p || p.x < 8 || p.x > groesse.b - 8 || p.y < 110 || p.y > groesse.h - 60) continue
    if (schilder.some((s) => Math.abs(s.x - p.x) < MIN_ABSTAND)) continue
    const oben = Math.max(150, p.y - 56)
    schilder.push({ g: k.g, gh: k.gh, x: p.x, y: p.y, linie: Math.max(12, p.y - oben), geprueft: gelaende !== null })
    if (schilder.length >= 12) break
  }

  // Schilder mit dem Finger seitlich zurechtschieben (gleicht Kompass-Fehler aus)
  function zugStart(ev: React.PointerEvent) {
    zug.current = { x: ev.clientX, versatz: fein.versatz }
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  function zugWeiter(ev: React.PointerEvent) {
    const z = zug.current
    if (!z) return
    const grad = (Math.atan((ev.clientX - z.x) / brennweite) * 180) / Math.PI
    setFein((f) => ({ ...f, versatz: Math.max(-40, Math.min(40, z.versatz - grad)) }))
  }
  function zugEnde() {
    zug.current = null
  }

  /** Kamerabild samt Namensschildern als Foto speichern. */
  async function aufnehmen() {
    if (!onFoto || fotoStand === 'laeuft') return
    setFotoStand('laeuft')
    try {
      const dichte = Math.min(2, window.devicePixelRatio || 1)
      const flaeche = document.createElement('canvas')
      flaeche.width = Math.round(groesse.b * dichte)
      flaeche.height = Math.round(groesse.h * dichte)
      const z = flaeche.getContext('2d')!
      z.scale(dichte, dichte)
      const v = video.current
      if (v && kamera === 'an' && bild) {
        const s = Math.max(groesse.b / bild.b, groesse.h / bild.h)
        z.drawImage(v, (groesse.b - bild.b * s) / 2, (groesse.h - bild.h * s) / 2, bild.b * s, bild.h * s)
      } else {
        const verlauf = z.createLinearGradient(0, 0, 0, groesse.h)
        verlauf.addColorStop(0, '#8fd3ff')
        verlauf.addColorStop(1, '#c9eeb8')
        z.fillStyle = verlauf
        z.fillRect(0, 0, groesse.b, groesse.h)
      }
      for (const s of schilder) {
        z.strokeStyle = '#ffffff'
        z.lineWidth = 2
        z.beginPath()
        z.moveTo(s.x, s.y)
        z.lineTo(s.x, s.y - s.linie)
        z.stroke()
        z.save()
        z.translate(s.x, s.y - s.linie)
        z.rotate(-Math.PI / 4)
        const text = `▲ ${s.g.name}  ${Math.round(s.gh)} m`
        z.font = '600 14px system-ui, sans-serif'
        const breite = z.measureText(text).width + 18
        z.fillStyle = '#c2189b'
        z.beginPath()
        z.roundRect(-4, -13, breite, 26, 8)
        z.fill()
        z.fillStyle = '#ffffff'
        z.textBaseline = 'middle'
        z.fillText(text, 5, 1)
        z.restore()
      }
      const blob = await new Promise<Blob | null>((ok) => flaeche.toBlob(ok, 'image/jpeg', 0.85))
      if (blob) await onFoto(blob)
      setFotoStand('fertig')
      setTimeout(() => setFotoStand('frei'), 2500)
    } catch {
      setFotoStand('frei')
    }
  }

  const blick = blickrichtung(drehung)
  const blickKarte = (blick + korrektur + 360) % 360

  return (
    <div className="ar" role="dialog" aria-label="Gipfel-Finder mit Kamerabild">
      <div
        ref={rahmen}
        className="ar-bild"
        onPointerDown={zugStart}
        onPointerMove={zugWeiter}
        onPointerUp={zugEnde}
        onPointerCancel={zugEnde}
      >
        <video
          ref={video}
          className={kamera === 'an' ? 'ar-video' : 'ar-video ar-video-aus'}
          playsInline
          muted
          onLoadedMetadata={(e) => setBild({ b: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
        />
        {schilder.map((s) => (
          <div key={gipfelSchluessel(s.g)} className="ar-gipfel" style={{ left: s.x, top: s.y }}>
            <span className="ar-linie" style={{ height: s.linie }} />
            <button
              type="button"
              className={s.geprueft ? 'ar-schild' : 'ar-schild ar-ungeprueft'}
              style={{ bottom: s.linie }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setGewaehlt(s.g)}
            >
              ▲ {s.g.name} <small>{Math.round(s.gh)} m</small>
            </button>
          </div>
        ))}
      </div>

      <header className="ar-kopf">
        <span className="ar-richtung">
          {richtungText(blickKarte)} · {Math.round(blickKarte)}°
        </span>
        <button type="button" onClick={onSchliessen}>
          Schließen
        </button>
      </header>

      <div className="ar-unten">
        {gewaehlt && (
          <p className="ar-info">
            <strong>{gewaehlt.name}</strong>
            {gewaehlt.hoehe ? ` · ${Math.round(gewaehlt.hoehe)} m` : ''} · {formatKm(gewaehlt.meter)} km entfernt ·{' '}
            {richtungText(gewaehlt.richtung)}
          </p>
        )}
        {!gewaehlt && (
          <p className="ar-info">
            Die Schilder zeigen, in welcher Richtung ein Gipfel liegt – auch durch Wände und Bäume hindurch.
            Draußen mit freier Sicht sitzen sie auf den Bergen. Schild antippen für die Entfernung.
          </p>
        )}
        {!gelaende && (
          <p className="ar-info">Ohne Netz kann ich verdeckte Gipfel nicht ausblenden – es werden alle gezeigt.</p>
        )}
        {kamera === 'aus' && (
          <p className="ar-info">Kein Kamerabild – die Schilder stehen trotzdem in der richtigen Richtung.</p>
        )}
        {sensor === 'nein' && (
          <label className="ar-regler">
            <span>Dieses Gerät meldet keine Lage – Blickrichtung hier einstellen:</span>
            <input
              type="range"
              min={0}
              max={359}
              value={blickVonHand}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setBlickVonHand(Number(e.target.value))}
            />
          </label>
        )}
        {feinOffen && (
          <div className="ar-fein">
            <p>
              Sitzen die Schilder seitlich daneben? Zieh sie mit dem Finger im Bild nach links oder rechts. Liegen sie
              zu weit auseinander oder zu eng, hilft der Bildwinkel:
            </p>
            <div className="ar-knoepfe">
              <button type="button" onClick={() => setFein((f) => ({ ...f, winkel: Math.min(90, f.winkel + 3) }))}>
                Enger
              </button>
              <button type="button" onClick={() => setFein((f) => ({ ...f, winkel: Math.max(40, f.winkel - 3) }))}>
                Weiter
              </button>
              <button type="button" onClick={() => setFein({ versatz: 0, winkel: 66 })}>
                Zurücksetzen
              </button>
            </div>
          </div>
        )}
        <div className="ar-knoepfe">
          <button type="button" onClick={onListe}>
            Liste
          </button>
          <button type="button" onClick={() => setFeinOffen((o) => !o)}>
            Anpassen
          </button>
          {onFoto && (
            <button type="button" className="haupt" disabled={fotoStand === 'laeuft'} onClick={aufnehmen}>
              {fotoStand === 'fertig' ? '✓ Gespeichert' : '📷 Foto'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
