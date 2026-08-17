import type { ReactNode } from "react";

import type { TacticalCameraMode } from "../features/tactical/TacticalEngine";

export function ViewIcon({ type }: { type: "radar" | "grid" | "sector" }) {
  if (type === "radar")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="11" />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 16 25 9M5 16h4M23 16h4M16 5v4M16 23v4" />
      </svg>
    );
  if (type === "grid")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 24 12 8h8l7 16ZM8 19h16M10 14h12M12 8l-2 16M20 8l2 16" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M10 5H5v5M22 5h5v5M10 27H5v-5M22 27h5v-5" />
      <circle cx="11" cy="17" r="2" />
      <circle cx="17" cy="12" r="1.5" />
      <circle cx="22" cy="19" r="2.5" />
    </svg>
  );
}

export function CameraIcon({ type }: { type: TacticalCameraMode }) {
  if (type === "player")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 24 16 6l10 18-10-4Z" />
        <circle cx="16" cy="16" r="12" />
      </svg>
    );
  if (type === "rts")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="m5 11 11-6 11 6-11 6Zm0 0v11l11 6 11-6V11M16 17v11" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="8" />
      <path d="M16 3v6M16 23v6M3 16h6M23 16h6" />
    </svg>
  );
}

export function MoveIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 24 21 8M14 8h7v7M5 24h15M5 24V9" />
    </svg>
  );
}

export function PollingControlIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {paused ? (
        <path d="M8 6v20l17-10Z" />
      ) : (
        <>
          <path d="M10 7v18M22 7v18" />
          <circle cx="16" cy="16" r="13" />
        </>
      )}
    </svg>
  );
}

export function HyperspaceIcon({ galactic = false }: { galactic?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {galactic ? (
        <>
          <circle cx="16" cy="16" r="3" />
          <circle cx="7" cy="9" r="2" />
          <circle cx="25" cy="7" r="2" />
          <circle cx="24" cy="24" r="2" />
          <path d="M9 10.5 14 14M19 14l4.5-5M19 18l3.5 4.5M5 25C13 19 20 12 27 4" />
        </>
      ) : (
        <>
          <circle cx="16" cy="16" r="10" />
          <path d="M3 16h9M20 16h9M16 3v9M16 20v9M11 21 21 11M12 10l10 10" />
          <circle cx="16" cy="16" r="2" />
        </>
      )}
    </svg>
  );
}

export type CommandIconType =
  | "target"
  | "scan"
  | "info"
  | "to"
  | "away"
  | "track"
  | "cancel"
  | "neutral"
  | "friendly"
  | "enemy"
  | "recharge"
  | "autoRecharge";

export function CommandIcon({ type }: { type: CommandIconType }) {
  const paths: Record<CommandIconType, ReactNode> = {
    target: (
      <>
        <circle cx="16" cy="16" r="8" />
        <path d="M16 3v7M16 22v7M3 16h7M22 16h7" />
      </>
    ),
    scan: (
      <>
        <path d="M5 23a18 18 0 0 1 18-18M8 26A18 18 0 0 1 26 8" />
        <circle cx="12" cy="20" r="3" />
      </>
    ),
    info: (
      <>
        <circle cx="16" cy="16" r="11" />
        <path d="M16 14v9M16 9v1" />
      </>
    ),
    to: (
      <>
        <path d="M4 16h20M18 9l7 7-7 7" />
        <circle cx="27" cy="16" r="2" />
      </>
    ),
    away: (
      <>
        <path d="M28 16H8M14 9l-7 7 7 7" />
        <circle cx="5" cy="16" r="2" />
      </>
    ),
    track: (
      <>
        <circle cx="16" cy="16" r="9" />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 3v4M16 25v4M3 16h4M25 16h4M21 11l6-6" />
      </>
    ),
    cancel: <path d="M7 7l18 18M25 7 7 25" />,
    neutral: (
      <>
        <circle cx="16" cy="16" r="10" />
        <path d="M11 16h10" />
      </>
    ),
    friendly: (
      <>
        <path d="M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z" />
        <path d="m11 16 3 3 7-7" />
      </>
    ),
    enemy: (
      <>
        <path d="M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z" />
        <path d="m11 12 10 10M21 12 11 22" />
      </>
    ),
    recharge: (
      <>
        <path d="M16 3 27 8v8c0 7-5 11-11 13C10 27 5 23 5 16V8Z" />
        <path d="m18 8-7 10h6l-3 8 8-12h-6z" />
      </>
    ),
    autoRecharge: (
      <>
        <path d="M16 4 26 8v8c0 6-4 10-10 12C10 26 6 22 6 16V8Z" />
        <path d="M11 16a5 5 0 0 1 8-4M21 11v4h-4M21 17a5 5 0 0 1-8 4M11 22v-4h4" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}
