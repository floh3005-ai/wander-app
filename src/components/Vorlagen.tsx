import { useState } from 'react'
import { formatKm } from '../lib/geo'
import { ladeRoute, routenImAusschnitt, type Route, type RoutenInfo } from '../lib/vorlagen'

interface Props {
  /** Aktueller Kartenausschnitt [west, süd, ost, nord] und Zoomstufe */
  ausschnitt: () => { rahmen: [number, number, number, number]; zoom: number } | null
  onVorschau: (route: Route | null) => void
  onUebernehmen: (route: Route) => Promise<void>
}

export default function Vorlagen({ ausschnitt, onVorschau, onUebernehmen }: Props) {
  const [liste, setListe] = useState<RoutenInfo[] | null>(null)
  const [gewaehlt, setGewaehlt] = useState<Route | null>(null)
  const [laedt, setLaedt] = useState<'liste' | 'route' | 'tour' | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  async function suchen() {
    const a = ausschnitt()
    if (!a) return
    setFehler(null)
    if (a.zoom < 9.5) {
      setFehler('Bitte erst näher an die Gegend heranzoomen, in der Du wandern möchtest.')
      return
    }
    setLaedt('liste')
    try {
      setListe(await routenImAusschnitt(a.rahmen))
      setGewaehlt(null)
      onVorschau(null)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    }
    setLaedt(null)
  }

  async function ansehen(info: RoutenInfo) {
    setFehler(null)
    setLaedt('route')
    try {
      const route = await ladeRoute(info.id)
      setGewaehlt(route)
      onVorschau(route)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    }
    setLaedt(null)
  }

  async function uebernehmen() {
    if (!gewaehlt) return
    setLaedt('tour')
    try {
      await onUebernehmen(gewaehlt)
      setGewaehlt(null)
      onVorschau(null)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    }
    setLaedt(null)
  }

  return (
    <div className="vorlagen">
      <p className="leise">
        Ausgeschilderte Wanderrouten aus dem Kartenausschnitt. Eine Route ansehen, als eigene Tour
        übernehmen und dann frei anpassen.
      </p>
      <button type="button" className={liste ? '' : 'haupt'} disabled={laedt !== null} onClick={suchen}>
        {laedt === 'liste' ? 'Suche läuft …' : 'Routen in diesem Ausschnitt suchen'}
      </button>
      {fehler && <p className="warnung">{fehler}</p>}
      {liste && liste.length === 0 && <p className="leise">Hier sind keine Wanderrouten eingetragen.</p>}
      {liste && liste.length > 0 && (
        <ul className="routen">
          {liste.map((r) => {
            const offen = gewaehlt?.id === r.id
            return (
              <li key={r.id} className={offen ? 'offen' : ''}>
                <button type="button" className="routen-knopf" disabled={laedt !== null} onClick={() => ansehen(r)}>
                  <strong>{r.name}</strong>
                  <span>
                    {[r.kuerzel, r.ebene].filter(Boolean).join(' · ')}
                    {offen && gewaehlt ? ` · ${formatKm(gewaehlt.meter)} km` : ''}
                  </span>
                </button>
                {offen && gewaehlt && (
                  <div className="routen-aktion">
                    {gewaehlt.unvollstaendig && (
                      <p className="warnung">
                        Diese Route hat Lücken oder Abzweigungen – blau siehst Du den längsten
                        zusammenhängenden Teil.
                      </p>
                    )}
                    <button type="button" className="haupt" disabled={laedt !== null} onClick={uebernehmen}>
                      {laedt === 'tour' ? 'Tour wird vorbereitet …' : 'Als neue Tour übernehmen'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
