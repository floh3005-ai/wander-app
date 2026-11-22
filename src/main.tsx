import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/** Fängt unerwartete Fehler ab, damit nie nur eine leere Seite zu sehen ist. */
class Auffangnetz extends Component<{ children: ReactNode }, { fehler: boolean }> {
  state = { fehler: false }

  static getDerivedStateFromError() {
    return { fehler: true }
  }

  render() {
    if (!this.state.fehler) return this.props.children
    return (
      <div className="panne">
        <h1>Da ist etwas schiefgelaufen</h1>
        <p>Deine Touren sind gespeichert. Lade die Seite einfach neu.</p>
        <button type="button" className="haupt" onClick={() => location.reload()}>
          Seite neu laden
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <Auffangnetz>
    <App />
  </Auffangnetz>,
)
