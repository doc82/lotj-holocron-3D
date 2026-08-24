import { useState } from "react";

import { AssetCredits } from "./AssetCredits";
import styles from "./ManagementMenu.module.css";

interface Props {
  onClose(): void;
}

export function ManagementMenu({ onClose }: Props) {
  const [section, setSection] = useState<"hyperspace-logging" | "credits" | null>(null);
  const title =
    section === "hyperspace-logging"
      ? "HYPERSPACE DIAGNOSTICS"
      : section === "credits"
        ? "CREDITS"
        : "SYSTEM MENU";

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.menu} role="dialog" aria-modal="true" aria-label="Management menu">
        <header>
          <div>
            <small>HOLOCRON MANAGEMENT</small>
            <h2>{title}</h2>
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
            <button type="button" onClick={() => setSection("credits")}>
              <span>THIRD-PARTY NOTICES</span>
              <strong>ASSET CREDITS</strong>
              <small>VIEW CREATORS, SOURCE LINKS, AND LICENSES</small>
            </button>
          </div>
        ) : section === "hyperspace-logging" ? (
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
        ) : (
          <div className={styles.diagnostics}>
            <div className={styles.toolbar}>
              <button type="button" onClick={() => setSection(null)}>
                ← MENU
              </button>
              <span>THIRD-PARTY ASSET ATTRIBUTION</span>
            </div>
            <AssetCredits />
          </div>
        )}
      </section>
    </div>
  );
}
