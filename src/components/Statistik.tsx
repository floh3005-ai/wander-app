import { formatDauer, formatKm } from '../lib/geo'
import type { Tour } from '../lib/typen'

interface Props {
  touren: Tour[]
}

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function summe(touren: Tour[]) {
  let meter = 0
  let auf = 0
  let sekunden = 0
  for (const t of touren) {
    meter += t.aufzeichnung!.meter
    auf += t.aufzeichnung!.auf
    sekunden += t.aufzeichnung!.gehzeit
  }
  return { anzahl: touren.length, meter, auf, sekunden }
}

/** Überblick über die aufgezeichneten Wanderungen. */
export default function Statistik({ touren }: Props) {
  const gewandert = touren.filter((t) => t.aufzeichnung)
  if (gewandert.length === 0) {
    return <p className="leise">Sobald Du Wanderungen aufgezeichnet hast, steht hier Deine Statistik.</p>
  }

  const jahr = new Date().getFullYear()
  const diesesJahr = summe(gewandert.filter((t) => new Date(t.aufzeichnung!.beginn).getFullYear() === jahr))
  const gesamt = summe(gewandert)

  // Die letzten zwölf Monate als Balken
  const jetzt = new Date()
  const monate = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(jetzt.getFullYear(), jetzt.getMonth() - 11 + i, 1)
    const teil = gewandert.filter((t) => {
      const b = new Date(t.aufzeichnung!.beginn)
      return b.getFullYear() === d.getFullYear() && b.getMonth() === d.getMonth()
    })
    return { name: MONATE[d.getMonth()], meter: summe(teil).meter, anzahl: teil.length }
  })
  const hoechster = Math.max(1, ...monate.map((m) => m.meter))

  const laengste = gewandert.reduce((a, b) => (b.aufzeichnung!.meter > a.aufzeichnung!.meter ? b : a))
  const steilste = gewandert.reduce((a, b) => (b.aufzeichnung!.auf > a.aufzeichnung!.auf ? b : a))

  const zeile = (titel: string, s: ReturnType<typeof summe>) => (
    <div className="stat-zeile">
      <h3>{titel}</h3>
      <dl>
        <div>
          <dt>Wanderungen</dt>
          <dd>{s.anzahl}</dd>
        </div>
        <div>
          <dt>Strecke</dt>
          <dd>{formatKm(s.meter)} km</dd>
        </div>
        <div>
          <dt>Bergauf</dt>
          <dd>{s.auf.toLocaleString('de-DE')} m</dd>
        </div>
        <div>
          <dt>Gehzeit</dt>
          <dd>{formatDauer(s.sekunden / 60)}</dd>
        </div>
      </dl>
    </div>
  )

  return (
    <div className="stat">
      {zeile(`Dieses Jahr (${jahr})`, diesesJahr)}
      {gesamt.anzahl !== diesesJahr.anzahl && zeile('Insgesamt', gesamt)}

      <div className="stat-balken" role="img" aria-label="Gewanderte Kilometer in den letzten zwölf Monaten">
        {monate.map((m, i) => (
          <div key={i} title={`${m.name}: ${formatKm(m.meter)} km, ${m.anzahl} Wanderung${m.anzahl === 1 ? '' : 'en'}`}>
            <span className="stat-wert">{m.meter > 0 ? Math.round(m.meter / 1000) : ''}</span>
            <span className="stat-saeule" style={{ height: `${Math.max(m.meter > 0 ? 6 : 0, (m.meter / hoechster) * 100)}%` }} />
            <span className="stat-monat">{m.name}</span>
          </div>
        ))}
      </div>
      <p className="leise">Kilometer je Monat, letzte zwölf Monate</p>

      <p className="stat-rekord">
        🏅 Längste: <strong>{laengste.name}</strong> ({formatKm(laengste.aufzeichnung!.meter)} km)
        <br />
        ⛰️ Meiste Höhenmeter: <strong>{steilste.name}</strong> ({steilste.aufzeichnung!.auf} m)
      </p>
    </div>
  )
}
