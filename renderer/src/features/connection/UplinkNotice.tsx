import styles from "./UplinkNotice.module.css";

export function UplinkNotice() {
  return (
    <section className={styles.uplink} role="status" aria-live="polite">
      <div className={styles.reticle} aria-hidden="true"><span /><span /><span /></div>
      <p className={styles.eyebrow}>TACTICAL LINK // STANDBY</p>
      <h2>Waiting for uplink to your Ship, Captain</h2>
      <p className={styles.detail}>Launch the Holocron3D Mudlet package or enter <code>h3d start</code></p>
      <div className={styles.scan} aria-hidden="true"><i /></div>
    </section>
  );
}
