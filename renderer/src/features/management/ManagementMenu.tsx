import { useMemo, useState, type FormEvent } from "react";

import {
  effectiveHyperspeed,
  normalizedHyperspaceLoad,
  sortHyperspaceHistory,
  type HyperspaceHistoryDraft,
  type HyperspaceHistoryEntry,
  type HyperspaceHistorySortKey,
} from "../../domain/hyperspaceHistory";
import styles from "./ManagementMenu.module.css";

interface Props {
  entries: HyperspaceHistoryEntry[];
  onAdd(entry: HyperspaceHistoryDraft): boolean;
  onRemove(id: string): void;
  onClear(): void;
  onClose(): void;
}

const numberLabel = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ManagementMenu({ entries, onAdd, onRemove, onClear, onClose }: Props) {
  const [section, setSection] = useState<"history" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [sortKey, setSortKey] = useState<HyperspaceHistorySortKey>("completedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [mode, setMode] = useState<"local" | "galactic">("local");
  const [distance, setDistance] = useState(10_000);
  const [hyperspeed, setHyperspeed] = useState(5);
  const [navigatorApplied, setNavigatorApplied] = useState(false);
  const [calculationSeconds, setCalculationSeconds] = useState(5);
  const [flightSeconds, setFlightSeconds] = useState(20);
  const sortedEntries = useMemo(
    () => sortHyperspaceHistory(entries, sortKey, sortDirection),
    [entries, sortDirection, sortKey],
  );

  const chooseSort = (key: HyperspaceHistorySortKey) => {
    if (key === sortKey) setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const added = onAdd({
      completedAt: Date.now() / 1_000,
      mode,
      distance,
      hyperspeed,
      navigatorApplied,
      calculationSeconds,
      flightSeconds,
      source: "manual",
    });
    if (added) setShowAdd(false);
  };

  const column = (key: HyperspaceHistorySortKey, label: string) => (
    <button type="button" onClick={() => chooseSort(key)}>
      {label} {sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : ""}
    </button>
  );

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.menu} aria-label="Management menu">
        <header>
          <div>
            <small>HOLOCRON MANAGEMENT</small>
            <h2>{section === "history" ? "HYPERSPACE HISTORY" : "SYSTEM MENU"}</h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close menu">
            ×
          </button>
        </header>

        {section === null ? (
          <div className={styles.menuChoices}>
            <button type="button" onClick={() => setSection("history")}>
              <span>CALIBRATION DATABASE</span>
              <strong>HYPERSPACE HISTORY</strong>
              <small>{entries.length} RECORDED JUMPS // VIEW, ADD, OR REMOVE DATA</small>
            </button>
            <p>Additional management modules will appear here as they become available.</p>
          </div>
        ) : (
          <div className={styles.history}>
            <div className={styles.toolbar}>
              <button type="button" onClick={() => setSection(null)}>
                ← MENU
              </button>
              <span>{entries.length} / 200 RECORDS</span>
              <button type="button" onClick={() => setShowAdd((current) => !current)}>
                {showAdd ? "CANCEL ADD" : "+ ADD RECORD"}
              </button>
              <button
                type="button"
                className={styles.danger}
                disabled={entries.length === 0}
                onClick={() => setConfirmClear(true)}
              >
                CLEAR DATABASE
              </button>
            </div>

            {showAdd && (
              <form className={styles.addForm} onSubmit={submit}>
                <label>
                  MODE
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as typeof mode)}
                  >
                    <option value="local">LOCAL</option>
                    <option value="galactic">GALACTIC</option>
                  </select>
                </label>
                <label>
                  DISTANCE
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    value={distance}
                    onChange={(event) => setDistance(Number(event.target.value))}
                  />
                </label>
                <label>
                  HYPERSPEED
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={hyperspeed}
                    onChange={(event) => setHyperspeed(Number(event.target.value))}
                  />
                </label>
                <label>
                  CALC SECONDS
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.1"
                    value={calculationSeconds}
                    onChange={(event) => setCalculationSeconds(Number(event.target.value))}
                  />
                </label>
                <label>
                  FLIGHT SECONDS
                  <input
                    required
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={flightSeconds}
                    onChange={(event) => setFlightSeconds(Number(event.target.value))}
                  />
                </label>
                <label className={styles.navigatorField}>
                  <input
                    type="checkbox"
                    checked={navigatorApplied}
                    onChange={(event) => setNavigatorApplied(event.target.checked)}
                  />
                  NAVIGATOR +30%
                </label>
                <button type="submit">SAVE RECORD</button>
              </form>
            )}

            <div className={styles.tableFrame}>
              <table>
                <thead>
                  <tr>
                    <th>{column("completedAt", "COMPLETED")}</th>
                    <th>MODE</th>
                    <th>{column("distance", "DISTANCE")}</th>
                    <th>{column("hyperspeed", "RATING")}</th>
                    <th>{column("navigatorApplied", "NAV")}</th>
                    <th>{column("normalizedLoad", "LOAD")}</th>
                    <th>{column("calculationSeconds", "CALC")}</th>
                    <th>{column("flightSeconds", "FLIGHT")}</th>
                    <th>{column("totalSeconds", "TOTAL")}</th>
                    <th>SOURCE</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.completedAt * 1_000).toLocaleString()}</td>
                      <td>{entry.mode.toUpperCase()}</td>
                      <td>{numberLabel(entry.distance)}</td>
                      <td>{numberLabel(entry.hyperspeed)}</td>
                      <td>
                        {entry.navigatorApplied
                          ? `YES // ${numberLabel(effectiveHyperspeed(entry))}`
                          : "NO"}
                      </td>
                      <td>{numberLabel(normalizedHyperspaceLoad(entry))}</td>
                      <td>
                        {entry.calculationSeconds === undefined
                          ? "—"
                          : `${numberLabel(entry.calculationSeconds)}s`}
                      </td>
                      <td>{numberLabel(entry.flightSeconds)}s</td>
                      <td>{numberLabel((entry.calculationSeconds ?? 0) + entry.flightSeconds)}s</td>
                      <td>{entry.source.toUpperCase()}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.deleteRow}
                          onClick={() => onRemove(entry.id)}
                          aria-label={`Delete hyperspace record from ${new Date(entry.completedAt * 1_000).toLocaleString()}`}
                        >
                          DELETE
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sortedEntries.length === 0 && (
                    <tr>
                      <td colSpan={11} className={styles.empty}>
                        NO COMPLETED JUMPS RECORDED // ADD A DEBUG RECORD OR COMPLETE A LOCAL JUMP
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {confirmClear && (
        <div className={styles.confirmBackdrop} role="presentation">
          <section
            className={styles.confirm}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
          >
            <small>DESTRUCTIVE DATABASE ACTION</small>
            <h3 id="clear-history-title">
              Are you sure you want to delete your hyperspace database?
            </h3>
            <p>
              This permanently removes every locally observed and manually added calibration record.
            </p>
            <div>
              <button type="button" onClick={() => setConfirmClear(false)}>
                KEEP DATABASE
              </button>
              <button
                type="button"
                className={styles.danger}
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
              >
                DELETE DATABASE
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
