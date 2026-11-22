import { useEffect, useState } from 'react'
import { holeBild } from '../lib/fotos'
import type { FotoInfo } from '../lib/typen'

/** Ein Foto anzeigen. Lädt das Bild vom Gerät oder aus der Cloud. */
export function FotoBild({ id, className, onClick }: { id: string; className?: string; onClick?: () => void }) {
  const [adresse, setAdresse] = useState<string | null>(null)
  const [fehlt, setFehlt] = useState(false)

  useEffect(() => {
    let aktuell = true
    let url: string | null = null
    setAdresse(null)
    setFehlt(false)
    holeBild(id)
      .then((bild) => {
        if (!aktuell) return
        if (!bild) {
          setFehlt(true)
          return
        }
        url = URL.createObjectURL(bild)
        setAdresse(url)
      })
      .catch(() => aktuell && setFehlt(true))
    return () => {
      aktuell = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])

  if (fehlt) {
    return (
      <span className={`foto-fehlt ${className ?? ''}`} title="Dieses Foto ist noch nicht in der Cloud angekommen">
        📷 …
      </span>
    )
  }
  if (!adresse) return <span className={`foto-laedt ${className ?? ''}`} />
  return onClick ? (
    <button type="button" className={`foto-knopf ${className ?? ''}`} onClick={onClick}>
      <img src={adresse} alt="Foto von der Tour" />
    </button>
  ) : (
    <img className={className} src={adresse} alt="Foto von der Tour" />
  )
}

interface GrossProps {
  foto: FotoInfo
  onSchliessen: () => void
  onLoeschen?: () => void
  onZeigen?: () => void
}

/** Foto groß anzeigen. */
export function FotoGross({ foto, onSchliessen, onLoeschen, onZeigen }: GrossProps) {
  useEffect(() => {
    const taste = (e: KeyboardEvent) => e.key === 'Escape' && onSchliessen()
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [onSchliessen])

  return (
    <div className="foto-gross" role="dialog" aria-label="Foto" onClick={onSchliessen}>
      <div className="foto-gross-inhalt" onClick={(e) => e.stopPropagation()}>
        <FotoBild id={foto.id} />
        <div className="foto-gross-leiste">
          <span>
            {new Date(foto.zeit).toLocaleString('de-DE', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {onZeigen && foto.lon !== undefined && (
            <button type="button" onClick={onZeigen}>
              Auf der Karte
            </button>
          )}
          {onLoeschen && (
            <button type="button" onClick={onLoeschen}>
              Löschen
            </button>
          )}
          <button type="button" className="haupt" onClick={onSchliessen}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  fotos: FotoInfo[]
  laedt: boolean
  onDazu: () => void
  onOeffnen: (foto: FotoInfo) => void
}

/** Foto-Kachel im Planer. */
export default function Fotos({ fotos, laedt, onDazu, onOeffnen }: Props) {
  return (
    <div className="fotos">
      {fotos.length === 0 ? (
        <p className="leise">
          Noch keine Fotos. Unterwegs nimmst Du sie in der Handy-App auf – oder Du fügst hier welche vom PC hinzu.
        </p>
      ) : (
        <div className="foto-raster">
          {fotos.map((f) => (
            <FotoBild key={f.id} id={f.id} onClick={() => onOeffnen(f)} />
          ))}
        </div>
      )}
      <button type="button" disabled={laedt} onClick={onDazu}>
        {laedt ? 'Fotos werden verarbeitet …' : 'Fotos hinzufügen'}
      </button>
    </div>
  )
}
