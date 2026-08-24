import { planetAssetCredits, shipAssetCredits, type AssetCredit } from "../../domain/assetCredits";

import styles from "./ManagementMenu.module.css";

function ExternalLink({ label, url }: { label: string; url?: string }) {
  if (!url) return null;
  return (
    <button
      type="button"
      className={styles.creditLink}
      title={url}
      onClick={() => void window.holocron?.openExternal(url)}
    >
      {label}
    </button>
  );
}

function CreditCard({ credit }: { credit: AssetCredit }) {
  return (
    <article className={styles.creditCard}>
      <div className={styles.creditHeading}>
        <div>
          <h4>{credit.title}</h4>
          <p>{credit.usage}</p>
        </div>
        {!credit.releaseEligible && <span>LOCAL EVALUATION ONLY</span>}
      </div>
      <dl>
        <div>
          <dt>CREATOR</dt>
          <dd>{credit.author}</dd>
        </div>
        <div>
          <dt>LICENSE</dt>
          <dd>{credit.license}</dd>
        </div>
      </dl>
      <div className={styles.creditLinks}>
        <ExternalLink label="CREATOR PAGE ↗" url={credit.authorUrl} />
        <ExternalLink label="MODEL SOURCE ↗" url={credit.sourceUrl} />
        <ExternalLink label="LICENSE ↗" url={credit.licenseUrl} />
      </div>
    </article>
  );
}

export function AssetCredits() {
  const packagedShipCount = shipAssetCredits.filter((credit) => credit.releaseEligible).length;

  return (
    <div className={styles.creditsContent}>
      <section className={styles.creditIntro}>
        <small>THIRD-PARTY ARTWORK</small>
        <h3>ASSET ATTRIBUTION</h3>
        <p>
          Holocron is a non-profit, non-monetized fan project. Third-party artwork remains subject
          to its source license and is not covered by the Holocron source-code license.
        </p>
      </section>

      <section className={styles.creditSection}>
        <div className={styles.creditSectionHeading}>
          <div>
            <small>TACTICAL GEOMETRY</small>
            <h3>SHIP MODELS</h3>
          </div>
          <span>
            {packagedShipCount} RELEASE-ELIGIBLE // {shipAssetCredits.length} CATALOGED
          </span>
        </div>
        <div className={styles.creditGrid}>
          {shipAssetCredits.map((credit) => (
            <CreditCard key={credit.id} credit={credit} />
          ))}
        </div>
      </section>

      <section className={styles.creditSection}>
        <div className={styles.creditSectionHeading}>
          <div>
            <small>WORLD SURFACES</small>
            <h3>PLANET TEXTURES</h3>
          </div>
          <span>{planetAssetCredits.length} DIFFUSE + DETAIL SETS</span>
        </div>
        <p className={styles.creditNotice}>
          Resized and compressed derivatives by Shiny_Man. These files may not be extracted,
          republished as a standalone texture pack, or used for machine learning or generative AI.
        </p>
        <div className={styles.creditGrid}>
          {planetAssetCredits.map((credit) => (
            <CreditCard key={credit.id} credit={credit} />
          ))}
        </div>
      </section>

      <aside className={styles.creditLegal}>
        Star Wars and related names are trademarks of their respective owners. This project is not
        affiliated with or endorsed by Lucasfilm, Disney, Sketchfab, Cults, or CGTrader.
      </aside>
    </div>
  );
}
