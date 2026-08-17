const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const targetPlatform = process.env.HOLOCRON_TARGET_PLATFORM || process.platform;
const targetArch = process.env.HOLOCRON_TARGET_ARCH || process.arch;
const relayPlatform = targetPlatform === "win32" ? "windows" : targetPlatform;
const relayName = targetPlatform === "win32" ? "holocron-relay.exe" : "holocron-relay";
const appIcon = path.resolve(
  __dirname,
  "assets",
  "icon",
  targetPlatform === "darwin" ? "holocron3d.icns" : "holocron3d.ico",
);

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Holocron3D",
    icon: appIcon,
    extraResource: [
      path.resolve(__dirname, "relay", "bin", `${relayPlatform}-${targetArch}`, relayName),
      path.resolve(__dirname, "out", "mudlet", "Holocron3D.mpackage"),
    ],
    ignore: [
      /^\/(docs|mudlet|poc|relay|tests|tools)(\/|$)/,
      /^\/renderer\/(src|index\.html|styles\.css)(\/|$)/,
      /^\/(tsconfig\.json|vite\.renderer\.config\.ts)$/,
      /^\/\.electron-smoke-profile(\/|$)/,
      /^\/\.gocache(\/|$)/,
      /^\/\.pnpm-store(\/|$)/,
      /^\/\.vscode(\/|$)/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "Holocron3D",
        authors: "Veska",
        description: "A real-time 3D tactical renderer for Legends of the Jedi space telemetry.",
        exe: "Holocron3D.exe",
        setupExe: "Holocron3D-Setup.exe",
        setupIcon: appIcon,
        noMsi: true,
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
      [FuseV1Options.WasmTrapHandlers]: true,
    }),
  ],
};
