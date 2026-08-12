const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Holocron3D",
    extraResource: [
      path.resolve(__dirname, "relay", "bin", "holocron-relay.exe"),
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
  makers: [{
    name: "@electron-forge/maker-squirrel",
    platforms: ["win32"],
    config: {
      name: "Holocron3D",
      authors: "Veska",
      description: "A real-time 3D tactical renderer for Legends of the Jedi space telemetry.",
      exe: "Holocron3D.exe",
      setupExe: "Holocron3D-Setup.exe",
      noMsi: true,
    },
  }],
  plugins: [new FusesPlugin({
    version: FuseVersion.V1,
    // @electron/fuses@1.x (pinned by @electron-forge/plugin-fuses's peer dep) predates
    // Electron's WasmTrapHandlers fuse, so it can't cover all fuses Electron 43 exposes.
    // Leaving this false lets that fuse keep Electron's own (enabled) default.
    strictlyRequireAllFuses: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    [FuseV1Options.WasmTrapHandlers]: true,
  })],
};
