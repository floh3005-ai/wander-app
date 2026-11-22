import { useEffect, useMemo, useState } from 'react'
import { formatDauer } from '../lib/geo'
import type { Punkt } from '../lib/typen'
import {
  VORHERSAGE_TAGE,
  heute,
  istGewitter,
  ladeWetter,
  plusMinuten,
  wetterText,
  type Stunde,
  type Vorhersage,
  type WetterOrt,
} from '../lib/wetter'

interface Props {
  punkte: Punkt[]
  minuten: number
  start: { datum: string; zeit: string } | undefined
  onStart: (start: { datum: string; zeit: string }) => void
}

function uhr(zeit: string): string {
  return zeit.slice(11, 16)
}

function tagText(datum: string): string {
  return new Date(`${datum}T12:00:00`).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export default function Wetter({ punkte, minuten, start, onStart }: Props) {
  const datum = start?.datum && start.datum >= heute() ? start.datum : heute()
  const zeit = start?.zeit ?? '09:00'
  // Vorhersage immer zusammen mit den Orten merken, für die sie geholt wurde
  const [stand, setStand] = useState<{ schluessel: string; daten: Vorhersage[] } | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laedt, setLaedt] = useState(false)

  // Start und – wenn es deutlich höher hinaufgeht – der höchste Punkt
  const orte = useMemo<WetterOrt[]>(() => {
    if (punkte.length < 2) return []
    const erster = punkte[0]
    let hoch = erster
    for (const p of punkte) if (Number.isFinite(p[2]) && (!Number.isFinite(hoch[2]) || p[2] > hoch[2])) hoch = p
    const liste: WetterOrt[] = [
      { lon: erster[0], lat: erster[1], hoehe: Number.isFinite(erster[2]) ? erster[2] : undefined },
    ]
    if (Number.isFinite(hoch[2]) && Number.isFinite(erster[2]) && hoch[2] - erster[2] >= 150) {
      liste.push({ lon: hoch[0], lat: hoch[1], hoehe: hoch[2] })
    }
    return liste
  }, [punkte])

  const schluessel = orte.map((o) => `${o.lat.toFixed(2)},${o.lon.toFixed(2)},${Math.round((o.hoehe ?? 0) / 50)}`).join('|')

  const daten = stand && stand.schluessel === schluessel ? stand.daten : null

  useEffect(() => {
    if (orte.length === 0) return
    let aktuell = true
    setLaedt(true)
    setFehler(null)
    // kurz warten, damit beim Ziehen eines Punkts nicht ständig neu gefragt wird
    const timer = setTimeout(() => {
      ladeWetter(orte)
        .then((d) => {
          if (aktuell) setStand({ schluessel, daten: d })
        })
        .catch((e) => {
          if (aktuell) setFehler(e instanceof Error ? e.message : 'Das Wetter konnte nicht geladen werden.')
        })
        .finally(() => {
          if (aktuell) setLaedt(false)
        })
    }, 600)
    return () => {
      aktuell = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel])

  if (punkte.length < 2) {
    return <p className="leise">Sobald Deine Tour zwei Punkte hat, zeige ich Dir hier das Wetter dazu.</p>
  }

  const maxDatum = plusMinuten(`${heute()}T00:00`, (VORHERSAGE_TAGE - 1) * 24 * 60).slice(0, 10)
  const beginn = `${datum}T${zeit}`
  const ende = plusMinuten(beginn, Math.round(minuten))

  // Volle Stunden von Start bis Ende
  const zeilen: { unten: Stunde; oben?: Stunde }[] = []
  if (daten) {
    let t = `${beginn.slice(0, 13)}:00`
    const letzte = ende.slice(14, 16) === '00' ? ende : `${plusMinuten(ende, 60).slice(0, 13)}:00`
    for (let i = 0; i < 30 && t <= letzte; i++) {
      const unten = daten[0].stunden.get(t)
      if (unten) zeilen.push({ unten, oben: daten[1]?.stunden.get(t) })
      t = plusMinuten(t, 60)
    }
  }

  const hinweise: string[] = []
  let kurz = ''
  if (daten && zeilen.length > 0) {
    const alle = zeilen.flatMap((z) => (z.oben ? [z.unten, z.oben] : [z.unten]))
    const tMin = Math.round(Math.min(...alle.map((s) => s.temp)))
    const tMax = Math.round(Math.max(...alle.map((s) => s.temp)))
    const regen = zeilen.reduce((summe, z) => summe + Math.max(z.unten.regen, z.oben?.regen ?? 0), 0)
    const boeen = Math.round(Math.max(...alle.map((s) => s.boeen)))
    kurz = `${tMin === tMax ? `${tMin} °C` : `${tMin} bis ${tMax} °C`}, ${
      regen < 0.2 ? (alle.some((s) => s.code >= 51) ? 'kaum Niederschlag' : 'trocken') : `${regen.toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm Niederschlag`
    }, Böen bis ${boeen} km/h`

    const gewitter = zeilen.find((z) => istGewitter(z.unten.code) || (z.oben && istGewitter(z.oben.code)))
    if (gewitter) hinweise.push(`Gewitter möglich ab ${uhr(gewitter.unten.zeit)} Uhr.`)
    if (boeen >= 60) hinweise.push(`Kräftiger Wind mit Böen bis ${boeen} km/h.`)
    if (alle.some((s) => s.code >= 71 && s.code <= 77) || alle.some((s) => s.code === 85 || s.code === 86)) {
      hinweise.push('Es kann schneien.')
    }
    const unter = daten[0].sonnenuntergang.get(datum)
    if (unter && ende > unter) {
      hinweise.push(`Sonnenuntergang ist um ${uhr(unter)} Uhr – Du wärst bis etwa ${uhr(ende)} Uhr unterwegs.`)
    }
    const auf = daten[0].sonnenaufgang.get(datum)
    if (auf && beginn < auf) hinweise.push(`Beim Start ist es noch dunkel (Sonnenaufgang ${uhr(auf)} Uhr).`)
  }

  return (
    <div className="wetter">
      <div className="wetter-wahl">
        <label>
          <span>Tag</span>
          <input
            type="date"
            value={datum}
            min={heute()}
            max={maxDatum}
            onChange={(e) => e.target.value && onStart({ datum: e.target.value, zeit })}
          />
        </label>
        <label>
          <span>Start</span>
          <input
            type="time"
            value={zeit}
            step={900}
            onChange={(e) => e.target.value && onStart({ datum, zeit: e.target.value })}
          />
        </label>
      </div>

      <p className="wetter-kopf">
        <strong>{tagText(datum)}</strong>, {zeit} bis ca. {uhr(ende)} Uhr
        <br />
        <span className="leise">geplante Zeit {formatDauer(minuten)} bei Deinem Tempo</span>
      </p>

      {laedt && !daten && <p className="leise">Wetter wird geladen …</p>}
      {fehler && <p className="warnung">{fehler}</p>}
      {daten && zeilen.length === 0 && !laedt && (
        <p className="leise">Für diesen Zeitraum gibt es noch keine Vorhersage.</p>
      )}

      {zeilen.length > 0 && (
        <>
          <p className="wetter-kurz">{kurz}</p>
          {hinweise.map((h) => (
            <p key={h} className="warnung">
              {h}
            </p>
          ))}
          <table className="wetter-tabelle">
            <thead>
              <tr>
                <th>Uhr</th>
                <th>Wetter</th>
                <th>{daten && daten.length > 1 ? 'Start' : '°C'}</th>
                {daten && daten.length > 1 && <th>Oben</th>}
                <th>Regen</th>
                <th>Böen</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => {
                const staerker = z.oben && z.oben.code > z.unten.code ? z.oben : z.unten
                const w = wetterText(staerker.code)
                const chance = Math.max(z.unten.regenChance ?? -1, z.oben?.regenChance ?? -1)
                const mm = Math.max(z.unten.regen, z.oben?.regen ?? 0)
                return (
                  <tr key={z.unten.zeit}>
                    <td>{uhr(z.unten.zeit)}</td>
                    <td>
                      <span aria-hidden="true">{w.zeichen}</span> {w.text}
                    </td>
                    <td>{Math.round(z.unten.temp)}°</td>
                    {daten && daten.length > 1 && <td>{z.oben ? `${Math.round(z.oben.temp)}°` : '–'}</td>}
                    <td>
                      {chance >= 0 ? `${chance} %` : '–'}
                      {mm >= 0.1 ? ` · ${mm.toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm` : ''}
                    </td>
                    <td>{Math.round(Math.max(z.unten.boeen, z.oben?.boeen ?? 0))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="leise">
            {daten && daten.length > 1
              ? `„Oben" ist der höchste Punkt der Tour (${Math.round(orte[1]?.hoehe ?? 0)} m). `
              : ''}
            Böen in km/h. Quelle: Open-Meteo. Je weiter der Tag weg ist, desto unsicherer.
          </p>
        </>
      )}
    </div>
  )
}
