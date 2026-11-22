import { useEffect, useState } from 'react'
import { istGewitter, ladeWetter, wetterText, type Stunde } from '../lib/wetter'

interface Props {
  lon: number
  lat: number
  /** Höhe über dem Meer, falls bekannt – macht die Temperatur genauer */
  hoehe: number | null
  /** Wie viele Stunden man voraussichtlich noch unterwegs ist */
  stunden: number
}

function stundenSchluessel(d: Date): string {
  const zwei = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:00`
}

/** Wetter für die nächsten Stunden am aktuellen Standort. */
export default function WetterUnterwegs({ lon, lat, hoehe, stunden }: Props) {
  const [daten, setDaten] = useState<Map<string, Stunde> | null>(null)
  const [, setTakt] = useState(0)

  // Grob gerundeter Standort: erst nach ein paar Kilometern neu fragen
  const ort = `${lat.toFixed(1)},${lon.toFixed(1)},${hoehe === null ? '' : Math.round(hoehe / 200)}`

  useEffect(() => {
    let aktuell = true
    const laden = () => {
      ladeWetter([{ lon, lat, hoehe: hoehe ?? undefined }])
        .then((d) => {
          if (aktuell) setDaten(d[0].stunden)
        })
        .catch(() => {}) // ohne Netz bleibt einfach der letzte Stand stehen
    }
    laden()
    // alle 20 Minuten nachsehen (die Abfrage selbst wird 30 Minuten gemerkt)
    const timer = setInterval(() => {
      laden()
      setTakt((n) => n + 1)
    }, 20 * 60 * 1000)
    return () => {
      aktuell = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ort])

  if (!daten) return null

  const anzahl = Math.min(6, Math.max(3, Math.ceil(stunden) + 1))
  const zeilen: Stunde[] = []
  const jetzt = new Date()
  for (let i = 0; i < anzahl; i++) {
    const s = daten.get(stundenSchluessel(new Date(jetzt.getTime() + i * 3600_000)))
    if (s) zeilen.push(s)
  }
  if (zeilen.length === 0) return null

  const gewitter = zeilen.find((s) => istGewitter(s.code))
  const regen = zeilen.find((s, i) => i > 0 && s.regen >= 0.3 && zeilen[0].regen < 0.3)

  return (
    <div className="uw-wetter">
      <ul>
        {zeilen.map((s, i) => {
          const w = wetterText(s.code)
          return (
            <li key={s.zeit} title={w.text}>
              <span className="uw-wetter-zeit">{i === 0 ? 'jetzt' : `${s.zeit.slice(11, 13)} Uhr`}</span>
              <span className="uw-wetter-bild" aria-hidden="true">
                {w.zeichen}
              </span>
              <span className="uw-wetter-temp">{Math.round(s.temp)}°</span>
              <span className="uw-wetter-regen">{s.regenChance !== null ? `${s.regenChance} %` : ''}</span>
            </li>
          )
        })}
      </ul>
      {gewitter && (
        <p className="warnung">
          ⛈️ Gewitter möglich {gewitter === zeilen[0] ? 'jetzt' : `ab ${gewitter.zeit.slice(11, 13)} Uhr`}.
        </p>
      )}
      {!gewitter && regen && <p className="uw-wetter-hinweis">🌧️ Ab {regen.zeit.slice(11, 13)} Uhr kann es regnen.</p>}
    </div>
  )
}
