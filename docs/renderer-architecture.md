# Renderer architecture

The renderer is organized around a small composition root, feature controllers, pure domain
selectors, and presentational components. `App.tsx` connects those pieces; it does not implement
transport workflows or acknowledgement state machines directly.

```text
Telemetry + Electron bridge
          |
          v
Feature controllers  <---->  Pure domain selectors / reducers
          |
          v
       App.tsx
          |
          v
Composable workspace views
```

## Composition root

`renderer/src/app/App.tsx` is responsible for:

- connecting telemetry to feature controllers;
- deriving the small amount of cross-feature state needed by multiple panels;
- passing explicit data and callbacks into workspace views; and
- selecting disconnected, startup, tactical, and hyperspace presentation states.

It must not call `window.holocron.sendIntent` or subscribe to `onIntentAck`. Those responsibilities
belong to feature controllers, where the complete lifecycle of an operation can be understood and
tested together.

## Domain layer

Pure calculations live under `renderer/src/domain`. In particular,
`domain/tacticalWorkspace.ts` owns snapshot classification, fleet aggregation, dossier resolution,
and tactical view-model helpers. These functions do not depend on React and have direct Node tests.

State transitions with meaningful rules should use pure reducers. Navigation is represented by
`features/commands/navigationReducer.ts`; the React controller only adds bridge I/O and canvas
coordination around that reducer.

## Feature controllers

Controllers own stateful workflows and external effects:

- `usePollingController` owns pause/resume and startup probing.
- `useFleetSelection` owns recipient scope, member selection, and remote viewpoint state.
- `useNavigationController` owns course staging, speed orders, keyboard controls, and navigation
  acknowledgements.
- `useShipCommandController` owns targeting, weapons, autotrack, fleet orders, and shield commands.
- `useHyperspaceController` owns plotting, clearance, engagement, transit, and escape workflows.
- `useShipDossierController` owns status/info scans and refreshed dossier data.
- `useTacticalInteractionController` owns target shortcuts, remote tactical requests, and combat
  target clearing.

A controller should expose the smallest useful state-and-action API. Keep transient intent IDs,
timeouts, bridge acknowledgements, and command-specific error recovery inside the controller that
issued the command.

## Presentation layer

The app-level views under `renderer/src/app` are composable sections rather than state owners:

- `TacticalChrome.tsx` renders the header and polling-paused overlay.
- `CommandActionPanel.tsx` renders context-sensitive local and formation actions.
- `WorkspacePanels.tsx` renders the fleet drawer, selected target, issuer, and contact cluster.
- `TacticalIcons.tsx` contains shared SVG primitives.

Feature-specific components remain beside their feature. Presentation components receive values
and callbacks through props and should not call the Electron bridge.

## Testing boundaries

- Pure selectors and reducers receive behavioral unit tests.
- Controller workflows are covered by focused source/contract tests alongside existing Mudlet and
  protocol tests.
- `tests/app-architecture.test.mjs` guards the composition boundary and prevents bridge I/O from
  drifting back into `App.tsx`.
- `tests/renderer-shell.test.mjs` treats the composed app views as one renderer surface, even though
  their implementation is split across several files.

When adding a new command, start with a focused feature controller and pass its state/actions into a
view. When adding a new calculation, prefer a pure domain function. Add code to `App.tsx` only when
it genuinely coordinates multiple features.
