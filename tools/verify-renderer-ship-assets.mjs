import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateShipAssetDirectory } from "./ship-asset-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = path.join(root, "renderer", "dist", "ship-models");
const count = await validateShipAssetDirectory(assetRoot);
console.log(`Verified ${count} attributed ship meshes in the renderer build at ${assetRoot}.`);
