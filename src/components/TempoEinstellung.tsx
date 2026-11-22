import { useState } from 'react'
import { MEIN_TEMPO, NORM_TEMPO, aktuellesTempo, setzeTempo, type Tempo } from '../lib/geo'

interface Props {
  /** Nach einer Änderung alle Zeiten neu berechnen lassen */
  onGeaendert: () => void
}

/** Eigenes Tempo für die Zeitplanung einstellen. */
export default function TempoEinstellung({ onGeaendert }: Props) {
  const [werte, setWerte] = useState<Tempo>(aktuellesTempo)

  function uebernehme(neu: Tempo) {
    setWerte(neu)
    if (neu.kmh > 0 && neu.auf > 0 && neu.ab > 0) {
      setzeTempo(neu)
      onGeaendert()
    }
  }

  const feld = (titel: string, einheit: string, schluessel: keyof Tempo, schritt: number) => (
    <label className="tempo-feld">
      <span>{titel}</span>
      <span className="tempo-eingabe">
        <input
          type="number"
          inputMode="decimal"
          min={schritt}
          step={schritt}
          value={Number.isFinite(werte[schluessel]) ? werte[schluessel] : ''}
          onChange={(e) => uebernehme({ ...werte, [schluessel]: Number(e.target.value.replace(',', '.')) })}
        />
        {einheit}
      </span>
    </label>
  )

  return (
    <div className="tempo">
      <p className="leise">
        Damit rechnet die App die geplante Zeit aus – inklusive kurzem Stehenbleiben und Gucken. Nach einer
        aufgezeichneten Wanderung steht trotzdem die reine Gehzeit da.
      </p>
      {feld('In der Ebene', 'km pro Stunde', 'kmh', 0.1)}
      {feld('Bergauf', 'Höhenmeter pro Stunde', 'auf', 10)}
      {feld('Bergab', 'Höhenmeter pro Stunde', 'ab', 10)}
      <div className="tempo-knoepfe">
        <button type="button" onClick={() => uebernehme(MEIN_TEMPO)}>
          Mein Tempo (2,8 / 200 / 300)
        </button>
        <button type="button" onClick={() => uebernehme(NORM_TEMPO)}>
          Wanderer-Norm (4 / 300 / 500)
        </button>
      </div>
    </div>
  )
}
