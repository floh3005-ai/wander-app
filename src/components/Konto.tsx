import { useState } from 'react'

export type AbgleichStand = 'aus' | 'laeuft' | 'ok' | 'fehler'

interface Props {
  /** false = noch kein Cloud-Projekt eingetragen */
  eingerichtet: boolean
  email: string | null
  stand: AbgleichStand
  zuletzt: Date | null
  fehler: string | null
  onAnmelden: (email: string, passwort: string) => Promise<string | null>
  onAbmelden: () => void
  onAbgleichen: () => void
}

export default function Konto(props: Props) {
  const [offen, setOffen] = useState(false)
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  const [meldung, setMeldung] = useState<string | null>(null)
  const [wartet, setWartet] = useState(false)

  if (!props.eingerichtet) {
    return (
      <div className="konto">
        <span className="konto-punkt grau" />
        <span className="konto-text">Touren liegen nur in diesem Browser</span>
      </div>
    )
  }

  async function anmelden(ev: React.FormEvent) {
    ev.preventDefault()
    setWartet(true)
    setMeldung(null)
    const fehler = await props.onAnmelden(email.trim(), passwort)
    setWartet(false)
    if (fehler) setMeldung(fehler)
    else {
      setPasswort('')
      setOffen(false)
    }
  }

  if (!props.email) {
    return (
      <div className="konto konto-spalte">
        <div className="konto-zeile">
          <span className="konto-punkt gelb" />
          <span className="konto-text">Nicht angemeldet – Touren nur in diesem Browser</span>
          {!offen && (
            <button type="button" className="haupt" onClick={() => setOffen(true)}>
              Anmelden
            </button>
          )}
        </div>
        {offen && (
          <form className="konto-form" onSubmit={anmelden}>
            <input
              type="email"
              placeholder="E-Mail"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Passwort"
              autoComplete="current-password"
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              required
            />
            {meldung && <p className="warnung">{meldung}</p>}
            <div className="konto-zeile">
              <button type="submit" className="haupt" disabled={wartet}>
                {wartet ? 'Moment …' : 'Anmelden'}
              </button>
              <button type="button" onClick={() => setOffen(false)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  const text =
    props.stand === 'laeuft'
      ? 'Abgleich läuft …'
      : props.stand === 'fehler'
        ? `Abgleich hat nicht geklappt: ${props.fehler ?? ''}`
        : props.zuletzt
          ? `In der Cloud gesichert · ${props.zuletzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
          : 'Angemeldet'

  const punkt = props.stand === 'fehler' ? 'rot' : props.stand === 'laeuft' ? 'gelb' : 'gruen'

  // Läuft alles, reicht eine schmale Zeile. Antippen klappt die Einzelheiten auf.
  if (!offen && props.stand !== 'fehler') {
    return (
      <button type="button" className="konto konto-klein" onClick={() => setOffen(true)} title="Cloud-Einstellungen zeigen">
        <span className={`konto-punkt ${punkt}`} />
        <span className="konto-text">{text}</span>
        <span aria-hidden="true">▾</span>
      </button>
    )
  }

  return (
    <div className="konto konto-spalte">
      <div className="konto-zeile">
        <span className={`konto-punkt ${punkt}`} />
        <span className="konto-text">{text}</span>
        <button type="button" onClick={() => setOffen(false)} aria-label="Einklappen">
          ▴
        </button>
      </div>
      <div className="konto-zeile">
        <span className="konto-mail">{props.email}</span>
        <button type="button" disabled={props.stand === 'laeuft'} onClick={props.onAbgleichen}>
          Jetzt abgleichen
        </button>
        <button type="button" onClick={props.onAbmelden}>
          Abmelden
        </button>
      </div>
    </div>
  )
}
