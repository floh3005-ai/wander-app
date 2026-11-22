import { NORM_TEMPO, type Tempo } from '../lib/geo'

interface Props {
  /** Eigenes Tempo dieser Tour – fehlt es, gilt „Mein Tempo" */
  tempo: Tempo | undefined
  onAendern: (tempo: Tempo | undefined) => void
}

/** Ausnahme: für eine einzelne Tour mit einem anderen Tempo rechnen (z. B. für jemand Fitteren). */
export default function TourTempo({ tempo, onAendern }: Props) {
  const feld = (titel: string, einheit: string, schluessel: keyof Tempo, schritt: number) => (
    <label className="tempo-feld">
      <span>{titel}</span>
      <span className="tempo-eingabe">
        <input
          type="number"
          inputMode="decimal"
          min={schritt}
          step={schritt}
          value={tempo && Number.isFinite(tempo[schluessel]) ? tempo[schluessel] : ''}
          onChange={(e) => {
            const zahl = Number(e.target.value.replace(',', '.'))
            if (tempo && zahl > 0) onAendern({ ...tempo, [schluessel]: zahl })
          }}
        />
        {einheit}
      </span>
    </label>
  )

  return (
    <div className="tempo tour-tempo">
      <label className="tour-tempo-schalter">
        <input
          type="checkbox"
          checked={!!tempo}
          onChange={(e) => onAendern(e.target.checked ? { ...NORM_TEMPO } : undefined)}
        />
        <strong>Ausnahme: eigenes Tempo nur für diese Tour</strong>
      </label>
      {tempo ? (
        <>
          <p className="leise">
            Gilt nur für die Tour, die Du gerade bearbeitest – auch am Handy. Die Steigung wird genauso
            eingerechnet wie sonst. Alle anderen Touren rechnen weiter mit „Mein Tempo".
          </p>
          {feld('In der Ebene', 'km pro Stunde', 'kmh', 0.1)}
          {feld('Bergauf', 'Höhenmeter pro Stunde', 'auf', 10)}
          {feld('Bergab', 'Höhenmeter pro Stunde', 'ab', 10)}
        </>
      ) : (
        <p className="leise">Zum Beispiel für eine Tour, die jemand Fitteres geht.</p>
      )}
    </div>
  )
}
