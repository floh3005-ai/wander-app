import { formatKm } from '../lib/geo'
import { hatAngaben, schlechtErkennbar, strecken, stufe } from '../lib/schwierigkeit'
import type { Punkt } from '../lib/typen'

interface Props {
  punkte: Punkt[]
  /** Zur ersten Stelle dieser Schwierigkeit springen */
  onZeigen: (punkt: Punkt) => void
}

export default function Schwierigkeit({ punkte, onZeigen }: Props) {
  if (punkte.length < 2) return null
  if (!hatAngaben(punkte)) {
    return (
      <p className="leise schwer-leer">
        Zur Schwierigkeit gibt es für diese Tour keine Angaben (übernommene GPX-Datei oder ältere Tour).
      </p>
    )
  }

  const alle = strecken(punkte)
  const summe = new Map<number, { meter: number; erster: Punkt }>()
  let unklar = 0
  let unklarErster: Punkt | null = null
  for (const s of alle) {
    const laenge = s.bisM - s.vonM
    const art = s.code % 10
    if (stufe(s.code)) {
      const eintrag = summe.get(art)
      if (eintrag) eintrag.meter += laenge
      else summe.set(art, { meter: laenge, erster: punkte[s.von] })
    }
    if (schlechtErkennbar(s.code)) {
      unklar += laenge
      if (!unklarErster) unklarErster = punkte[s.von]
    }
  }

  if (summe.size === 0 && unklar === 0) {
    return <p className="schwer-ok">✅ Keine schwierigen Abschnitte in den Wegdaten</p>
  }

  const hoechste = Math.max(0, ...summe.keys())
  return (
    <div className="schwer">
      <h3>
        {hoechste >= 3 ? '⚠️ Schwierige Abschnitte' : 'Abschnitte mit Anspruch'}
      </h3>
      <ul>
        {[...summe.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([art, e]) => {
            const s = stufe(art)!
            return (
              <li key={art}>
                <button type="button" onClick={() => onZeigen(e.erster)} title="Auf der Karte zeigen">
                  <span className="schwer-farbe" style={{ background: s.farbe }} />
                  <span className="schwer-text">
                    <strong>
                      {formatKm(e.meter)} km · {s.titel} ({s.kurz})
                    </strong>
                    <span>{s.text}</span>
                  </span>
                </button>
              </li>
            )
          })}
        {unklar > 0 && unklarErster && (
          <li>
            <button type="button" onClick={() => onZeigen(unklarErster!)} title="Auf der Karte zeigen">
              <span className="schwer-farbe schwer-unklar" />
              <span className="schwer-text">
                <strong>{formatKm(unklar)} km · Weg schlecht erkennbar</strong>
                <span>Im Gelände kaum Spuren oder Markierungen – Karte im Blick behalten.</span>
              </span>
            </button>
          </li>
        )}
      </ul>
      <p className="leise">
        Die Abschnitte sind auf der Karte und im Höhenprofil farbig markiert. Angaben aus OpenStreetMap –
        nicht jeder Weg ist eingestuft, Verhältnisse vor Ort können abweichen.
      </p>
    </div>
  )
}
