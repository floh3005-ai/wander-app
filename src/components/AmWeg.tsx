import { KATEGORIEN, zeichenFuer } from '../lib/orte'
import type { Kategorie, Ort } from '../lib/typen'

interface Props {
  hatWeg: boolean
  orte: Ort[] | undefined
  veraltet: boolean
  laedt: boolean
  sichtbar: Set<Kategorie>
  onSuchen: () => void
  onUmschalten: (kat: Kategorie) => void
  onWaehlen: (ort: Ort) => void
}

export default function AmWeg(props: Props) {
  const { orte } = props
  if (!props.hatWeg) {
    return <p className="leise">Sobald Deine Tour zwei Punkte hat, kann ich suchen, was am Weg liegt.</p>
  }

  const anzahl = new Map<Kategorie, number>()
  for (const o of orte ?? []) anzahl.set(o.kat, (anzahl.get(o.kat) ?? 0) + 1)
  const gezeigt = (orte ?? []).filter((o) => props.sichtbar.has(o.kat))

  return (
    <div className="amweg">
      {orte && props.veraltet && (
        <p className="warnung">Der Weg hat sich geändert – die Liste passt vielleicht nicht mehr.</p>
      )}
      <button type="button" className={orte && !props.veraltet ? '' : 'haupt'} disabled={props.laedt} onClick={props.onSuchen}>
        {props.laedt ? 'Suche läuft …' : orte ? 'Neu suchen' : 'Was liegt am Weg?'}
      </button>

      {orte && (
        <>
          <div className="chips">
            {KATEGORIEN.map((k) => {
              const n = anzahl.get(k.kat) ?? 0
              return (
                <button
                  key={k.kat}
                  type="button"
                  className={props.sichtbar.has(k.kat) ? 'chip an' : 'chip'}
                  disabled={n === 0}
                  aria-pressed={props.sichtbar.has(k.kat)}
                  onClick={() => props.onUmschalten(k.kat)}
                >
                  {k.zeichen} {k.titel} <span>{n}</span>
                </button>
              )
            })}
          </div>
          {orte.length === 0 ? (
            <p className="leise">An diesem Weg ist in den Kartendaten nichts eingetragen.</p>
          ) : gezeigt.length === 0 ? (
            <p className="leise">Wähl oben aus, was Du sehen möchtest.</p>
          ) : (
            <ul className="orte-liste">
              {gezeigt.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => props.onWaehlen(o)}>
                    <span className="ort-zeichen">{zeichenFuer(o.kat)}</span>
                    <span className="ort-text">
                      <strong>
                        {o.name}
                        {o.hoehe ? ` (${Math.round(o.hoehe)} m)` : ''}
                      </strong>
                      <span>
                        km {(o.km / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        {o.name !== o.art ? ` · ${o.art}` : ''}
                        {o.abstand > 60 ? ` · ${Math.round(o.abstand / 10) * 10} m neben dem Weg` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
