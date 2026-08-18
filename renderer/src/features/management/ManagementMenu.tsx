import { useState } from "react";

import styles from "./ManagementMenu.module.css";

interface Props {
  onClose(): void;
}

export function ManagementMenu({ onClose }: Props) {
  const [section, setSection] = useState<"hyperspace-logging" | null>(null);

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.menu} aria-label="Management menu">
        <header>
          <div>
            <small>HOLOCRON MANAGEMENT</small>
            <h2>{section ? "HYPERSPACE DIAGNOSTICS" : "SYSTEM MENU"}</h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close menu">
            ×
          </button>
        </header>

        {section === null ? (
          <div className={styles.menuChoices}>
            <button type="button" onClick={() => setSection("hyperspace-logging")}>
              <span>TEST INSTRUMENTATION</span>
              <strong>HYPERSPACE DIAGNOSTICS</strong>
              <small>VIEW THE DATA CAPTURED FOR EACH LOCAL JUMP</small>
            </button>
            <p>Additional management modules will appear here as they become available.</p>
          </div>
        ) : (
          <div className={styles.diagnostics}>
            <div className={styles.toolbar}>
              <button type="button" onClick={() => setSection(null)}>
                ← MENU
              </button>
              <span>LOG-BASED // NO CALIBRATION DATABASE</span>
            </div>

            <div className={styles.diagnosticContent}>
              <section>
                <small>CAPTURE STATUS</small>
                <h3>HOLOCRON LOCAL-JUMP SAMPLING IS ACTIVE</h3>
                <p>
                  Holocron writes structured sample markers directly into the Mudlet session log. It
                  does not retain a private history or adjust predictions from saved records.
                </p>
              </section>

              <section>
                <small>LOG MARKER</small>
                <code>[Holocron3D][HyperspaceSample]</code>
                <p>
                  Keep Mudlet logging enabled while testing. Share the resulting HTML log and the
                  markers can be extracted without manually transcribing timestamps.
                </p>
              </section>

              <section>
                <small>RECORDED LIFECYCLE</small>
                <ul>
                  <li>Plot time, origin, destination, 3D distance, drive rating, and estimate</li>
                  <li>Calculation ready time and whether Navigator was observed</li>
                  <li>Departure and the exact “Destination reached” transit boundary</li>
                  <li>Reentry completion, first radar position, and destination error</li>
                </ul>
              </section>

              <aside>
                Only jumps that include your current ship receive a complete timing sample. Remote
                wing ships do not expose authoritative departure and reentry events to your client.
              </aside>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
