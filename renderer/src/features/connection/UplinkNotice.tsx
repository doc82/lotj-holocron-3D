import styles from "./UplinkNotice.module.css";

export function UplinkNotice({ paused = false, reason }: { paused?: boolean; reason?: string }) {
  return (
    <section className={styles.uplink} role="status" aria-live="polite">
      <div className={styles.reticle} aria-hidden="true"><span /><span /><span /></div>
      <p className={styles.eyebrow}>TACTICAL LINK // {paused ? "SPACE TELEMETRY PAUSED" : "STANDBY"}</p>
      <h2>{paused ? "Waiting for space telemetry, Captain" : "Waiting for uplink to your Ship, Captain"}</h2>
      <p className={styles.detail}>{paused
        ? <>{reason || "Ship is landed"} // Launch your ship to resume tactical rendering</>
        : <>Launch the Holocron3D Mudlet package or enter <code>h3d start</code></>}</p>
      <div className={styles.scan} aria-hidden="true"><i /></div>
    </section>
  );
}
