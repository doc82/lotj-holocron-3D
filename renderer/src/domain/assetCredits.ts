import planetAssignments from "./planetTextureAssignments.json" with { type: "json" };
import shipCatalog from "./shipModelCatalog.json" with { type: "json" };

export interface AssetCredit {
  id: string;
  title: string;
  usage: string;
  author: string;
  authorUrl?: string;
  sourceUrl: string;
  license: string;
  licenseUrl?: string;
  releaseEligible: boolean;
}

interface ShipCatalogEntry {
  id: string;
  displayName: string;
  releaseEligible?: boolean;
  attribution: {
    title: string;
    author: string;
    authorUrl: string;
    source: string;
    license: string;
    licenseUrl: string;
  };
}

export const shipAssetCredits: AssetCredit[] = (shipCatalog.models as ShipCatalogEntry[]).map(
  (model) => ({
    id: model.id,
    title: model.attribution.title,
    usage: model.displayName,
    author: model.attribution.author,
    authorUrl: model.attribution.authorUrl || undefined,
    sourceUrl: model.attribution.source,
    license: model.attribution.license,
    licenseUrl: model.attribution.licenseUrl || undefined,
    releaseEligible: model.releaseEligible !== false,
  }),
);

export const planetAssetCredits: AssetCredit[] = planetAssignments.assignments.map(
  (assignment) => ({
    id: assignment.textureKey,
    title: assignment.source,
    usage: `${assignment.planet} diffuse and surface-detail maps`,
    author: "Shiny_Man",
    authorUrl: "https://www.cgtrader.com/designers/shinyman",
    sourceUrl: assignment.sourceUrl,
    license: "CGTrader Royalty Free License (No AI)",
    releaseEligible: true,
  }),
);
