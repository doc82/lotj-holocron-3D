import { DEFAULT_CARGO_TIMING, cargoTravelSeconds } from "../../domain/cargoRoutes";
import { useRef, useState } from "react";
import {
  parsePath,
  shipValidation,
  traderConfigId,
  type TraderConfigState,
  type TraderPadConfig,
  type TraderShipConfig,
} from "./traderConfig";
import styles from "./TraderWorkspace.module.css";

export function RemoveButton({ label, onRemove }: { label: string; onRemove(): void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className={styles.actions}>
      <span>Delete {label}?</span>
      <button
        type="button"
        className={styles.danger}
        onClick={() => {
          onRemove();
          setConfirm(false);
        }}
      >
        Delete
      </button>
      <button type="button" onClick={() => setConfirm(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button
      type="button"
      className={styles.quiet}
      onClick={() => setConfirm(true)}
      aria-label={`Delete ${label}`}
    >
      Delete
    </button>
  );
}

export function ShipSetup({
  config,
  onSave,
  onDelete,
  onSelect,
  onContinue,
}: {
  config: TraderConfigState;
  onSave(ship: TraderShipConfig): void;
  onDelete(id: string): void;
  onSelect(id: string): void;
  onContinue(): void;
}) {
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [timing, setTiming] = useState(DEFAULT_CARGO_TIMING);
  const [capacity, setCapacity] = useState("");
  const [enterPath, setEnterPath] = useState("");
  const [exitPath, setExitPath] = useState("");
  const [directCockpit, setDirectCockpit] = useState(false);
  const [hatchCode, setHatchCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const reset = () => {
    setEditing(undefined);
    setName("");
    setCapacity("");
    setTiming(DEFAULT_CARGO_TIMING);
    setEnterPath("");
    setExitPath("");
    setDirectCockpit(false);
    setHatchCode("");
    setError(null);
  };
  const edit = (ship: TraderShipConfig) => {
    setEditing(ship.id);
    setName(ship.name);
    setCapacity(String(ship.capacity));
    setTiming(ship.timing ?? DEFAULT_CARGO_TIMING);
    setEnterPath(ship.enterPath.join(", "));
    setExitPath(ship.exitPath.join(", "));
    setDirectCockpit(ship.directCockpit === true);
    setHatchCode(ship.hatchCode ?? "");
    setError(null);
    setNotice("");
    nameRef.current?.focus();
  };
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>YOUR FLEET</p>
          <h3>Make room for the next run.</h3>
          <p>Save a ship once, then use its cargo capacity to plan your routes.</p>
        </div>
        <button type="button" onClick={onContinue} disabled={!config.selectedShipId}>
          Create a route →
        </button>
      </div>
      <div className={styles.columns}>
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            const ship = {
              id: editing ?? traderConfigId(name),
              name: name.trim(),
              capacity: Number(capacity),
              timing,
              enterPath: parsePath(enterPath),
              exitPath: parsePath(exitPath),
              directCockpit,
              hatchCode: hatchCode.trim() || undefined,
            };
            const validation = shipValidation(ship, config.ships);
            if (validation) {
              setError(validation);
              return;
            }
            onSave(ship);
            setNotice(`${ship.name} ${editing ? "updated" : "added"}.`);
            reset();
          }}
        >
          <h4>{editing ? "Edit ship" : "Add a ship"}</h4>
          <label>
            Ship name
            <input
              autoComplete="off"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BlueSkies"
              required
              maxLength={100}
            />
            <small>Use the ship's exact in-game name.</small>
          </label>
          <label>
            Cargo capacity
            <input
              type="number"
              min="1"
              max="100000000"
              step="1"
              required
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 4500"
            />
            <small>Total cargo units this ship can carry.</small>
          </label>
          <details className={styles.details}>
            <summary>Travel and stop time estimates</summary>
            <label>
              Ship hyperspeed
              <input
                type="number"
                min="0.01"
                step="any"
                value={timing.hyperspeed ?? ""}
                onChange={(event) =>
                  setTiming({
                    ...timing,
                    hyperspeed: event.target.value === "" ? undefined : Number(event.target.value),
                  })
                }
                placeholder="e.g. 55"
              />
              <small>
                Enter the Hyperspeed rating from your ship's info. Leave blank to use manual travel
                timing.
              </small>
            </label>
            {timing.hyperspeed !== undefined && timing.hyperspeed > 0 && (
              <p>
                Estimated travel: {(cargoTravelSeconds(35, timing) / 60).toFixed(2)} minutes per 35
                parsecs. Calibrated from an observed jump; stop time is added separately.
              </p>
            )}
            <p>
              Without hyperspeed, travel defaults to 6 minutes per 35 sectors. Stops default to 3
              minutes. Stop time includes approach, landing or docking, refueling, trading and
              departure as applicable.
            </p>
            {(
              [
                ["minutesPer35Sectors", "Travel minutes per 35 sectors"],
                ["tradeStopMinutes", "Minutes at each market stop"],
                ["transitStopMinutes", "Minutes at each transit/refuel stop"],
              ] as const
            )
              .filter(
                ([field]) => field !== "minutesPer35Sectors" || timing.hyperspeed === undefined,
              )
              .map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    type="number"
                    required
                    min={field === "minutesPer35Sectors" ? "0.01" : "0"}
                    step="any"
                    value={Number.isNaN(timing[field]) ? "" : timing[field]}
                    onChange={(event) =>
                      setTiming({
                        ...timing,
                        [field]: event.target.value === "" ? NaN : Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
          </details>
          <details className={styles.details} open={editing !== undefined || undefined}>
            <summary>Ship access · required for autopilot</summary>
            <label>
              <input
                type="checkbox"
                checked={directCockpit}
                onChange={(event) => {
                  setDirectCockpit(event.target.checked);
                  if (event.target.checked) {
                    setEnterPath("");
                    setExitPath("");
                  }
                }}
              />
              Boarding enters the cockpit directly; no internal movement is needed.
            </label>
            <label>
              Entry path
              <input
                value={enterPath}
                disabled={directCockpit}
                onChange={(e) => setEnterPath(e.target.value)}
                placeholder="n, n, u"
              />
              <small>From inside the hatch to the control seat.</small>
            </label>
            <label>
              Exit path
              <input
                value={exitPath}
                disabled={directCockpit}
                onChange={(e) => setExitPath(e.target.value)}
                placeholder="d, s, s"
              />
              <small>From the control seat back to the hatch.</small>
            </label>
            <label>
              Hatch code
              <input
                type="password"
                autoComplete="off"
                inputMode="numeric"
                value={hatchCode}
                onChange={(e) => setHatchCode(e.target.value)}
                placeholder="Only if required"
              />
              <small>Leave blank when the hatch does not require a code.</small>
            </label>
            <p className={styles.hint}>
              Paths use directions separated by commas or spaces. Autopilot opens, boards and leaves
              the ship automatically. Both internal paths are required unless boarding enters the
              cockpit directly. You can still save a ship for planning without them.
            </p>
          </details>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.primary} type="submit">
              {editing ? "Save changes" : "Save ship"}
            </button>
            {editing && (
              <button type="button" onClick={reset}>
                Cancel edit
              </button>
            )}
          </div>
          <p role="status" className={styles.hint}>
            {notice}
          </p>
        </form>
        <section>
          <div className={styles.listHeading}>
            <h4>My ships</h4>
            <span>{config.ships.length} saved</span>
          </div>
          {!config.ships.length && (
            <div className={styles.empty}>
              <span className={styles.emptyMark}>01</span>
              <h4>Your first ship starts here</h4>
              <p>Add a name and cargo capacity. You can fill in access details later.</p>
            </div>
          )}
          <div className={styles.list}>
            {config.ships.map((ship) => (
              <article
                className={`${styles.card} ${config.selectedShipId === ship.id ? styles.selectedCard : ""}`}
                key={ship.id}
              >
                <div className={styles.cardHeading}>
                  <h4>{ship.name}</h4>
                  {config.selectedShipId === ship.id && (
                    <span className={styles.badge}>Selected for planning</span>
                  )}
                </div>
                <div className={styles.capacity}>
                  {ship.capacity.toLocaleString()} <small>cargo units</small>
                </div>
                <p className={styles.hint}>
                  Entry:{" "}
                  {ship.enterPath.join(" → ") ||
                    (ship.directCockpit ? "Direct cockpit" : "Required for autopilot")}
                  <br />
                  Exit:{" "}
                  {ship.exitPath.join(" → ") ||
                    (ship.directCockpit ? "Direct hatch" : "Required for autopilot")}
                  {ship.hatchCode && (
                    <>
                      <br />
                      Hatch code saved
                    </>
                  )}
                </p>
                <div className={styles.actions}>
                  {config.selectedShipId !== ship.id && (
                    <button type="button" onClick={() => onSelect(ship.id)}>
                      Use this ship
                    </button>
                  )}
                  <button type="button" onClick={() => edit(ship)} aria-label={`Edit ${ship.name}`}>
                    Edit
                  </button>
                  <RemoveButton
                    label={ship.name}
                    onRemove={() => {
                      onDelete(ship.id);
                      if (editing === ship.id) reset();
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export function PadSetup({
  pads,
  planets,
  initialPlanet,
  onSave,
  onDelete,
  onContinue,
}: {
  pads: TraderPadConfig[];
  planets: string[];
  initialPlanet: string;
  onSave(pad: TraderPadConfig, previousPlanet?: string): void;
  onDelete(planet: string): void;
  onContinue(): void;
}) {
  const [planet, setPlanet] = useState(initialPlanet);
  const initialPad = pads.find(
    (entry) => entry.planet.toLowerCase() === initialPlanet.toLowerCase(),
  );
  const [pad, setPad] = useState(initialPad?.pad ?? "");
  const [editing, setEditing] = useState<string | undefined>(initialPad?.planet);
  const planetRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const reset = () => {
    setPlanet("");
    setPad("");
    setEditing(undefined);
    setError("");
  };
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>LOCAL KNOWLEDGE</p>
          <h3>A familiar landing on every planet.</h3>
          <p>Keep one preferred secret pad per planet. It appears on every matching route stop.</p>
        </div>
        <button type="button" onClick={onContinue}>
          Back to route planning →
        </button>
      </div>
      <div className={styles.columns}>
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            const canonical =
              planets.find((entry) => entry.toLowerCase() === planet.trim().toLowerCase()) ??
              planet.trim();
            if (!canonical || !pad.trim()) {
              setError("Enter both a planet and a landing pad.");
              return;
            }
            if (
              pads.some(
                (entry) =>
                  entry.planet !== editing &&
                  entry.planet.toLowerCase() === canonical.toLowerCase(),
              )
            ) {
              setError("This planet already has a saved pad. Edit that entry to change it.");
              return;
            }
            onSave({ planet: canonical, pad: pad.trim() }, editing);
            setNotice(`Landing pad saved for ${canonical}.`);
            reset();
          }}
        >
          <h4>{editing ? "Edit secret pad" : "Add a secret pad"}</h4>
          <label>
            Planet
            <input
              list="trader-planet-options"
              ref={planetRef}
              value={planet}
              onChange={(e) => setPlanet(e.target.value)}
              placeholder="e.g. Naboo"
              required
              maxLength={100}
            />
            <small>Choose a known planet or enter its exact name.</small>
          </label>
          <datalist id="trader-planet-options">
            {planets.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <label>
            Landing pad
            <input
              value={pad}
              onChange={(e) => setPad(e.target.value)}
              placeholder="Exact landing pad name or identifier"
              required
              maxLength={150}
            />
            <small>Use the name or identifier the game accepts for landing.</small>
          </label>
          <p className={styles.hint}>
            Secret pads are optional. Stops without one are marked “No preferred pad” in your route
            preview.
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.primary} type="submit">
              {editing ? "Save changes" : "Save pad"}
            </button>
            {editing && (
              <button type="button" onClick={reset}>
                Cancel edit
              </button>
            )}
          </div>
          <p role="status" className={styles.hint}>
            {notice}
          </p>
        </form>
        <section>
          <div className={styles.listHeading}>
            <h4>Secret landing pads</h4>
            <span>{pads.length} saved</span>
          </div>
          {!pads.length && (
            <div className={styles.empty}>
              <span className={styles.emptyMark}>02</span>
              <h4>Keep your preferred pads close</h4>
              <p>Add the places you know. Your route previews will use them automatically.</p>
            </div>
          )}
          <div className={styles.list}>
            {pads.map((entry) => (
              <article className={styles.card} key={entry.planet}>
                <p className={styles.kicker}>{entry.planet}</p>
                <h4>{entry.pad}</h4>
                <div className={styles.actions}>
                  <button
                    type="button"
                    aria-label={`Edit pad for ${entry.planet}`}
                    onClick={() => {
                      setEditing(entry.planet);
                      setPlanet(entry.planet);
                      setPad(entry.pad);
                      setError("");
                      planetRef.current?.focus();
                    }}
                  >
                    Edit
                  </button>
                  <RemoveButton
                    label={`pad for ${entry.planet}`}
                    onRemove={() => {
                      onDelete(entry.planet);
                      if (editing === entry.planet) reset();
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
