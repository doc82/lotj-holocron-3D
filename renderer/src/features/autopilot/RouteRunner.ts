import {
  abortMission,
  prepareMission,
  confirmRouteOperation,
  nextRouteOperation,
  pauseMission,
  resumeMission,
  type RouteCheckpoint,
  type RouteAccounts,
  type RouteConfirmation,
  type RouteOperation,
} from "../../domain/routeAutopilot.ts";

export interface RouteTransport {
  // Resolve only after matching game output confirms the operation's outcome.
  // Reconciliation is read-only and receives the interrupted operation, if any.
  execute(
    operation: RouteOperation,
    checkpoint: RouteCheckpoint,
    signal: AbortSignal,
  ): Promise<RouteConfirmation>;
}

export interface RouteJournal {
  save(checkpoint: RouteCheckpoint): Promise<void>;
}

// Transport and journal are injected so navigation is reusable outside Trader.
export class RouteRunner {
  private runningSince?: number;
  private now: () => number;
  private controller?: AbortController;
  private driving = false;
  private currentDrive: Promise<void> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  public state: RouteCheckpoint;
  private transport: RouteTransport;
  private journal: RouteJournal;
  private changed: (state: RouteCheckpoint) => void;
  private timeoutMs: number;
  constructor(
    state: RouteCheckpoint,
    transport: RouteTransport,
    journal: RouteJournal,
    changed: (state: RouteCheckpoint) => void,
    timeoutMs = 45 * 60 * 1000,
    now: () => number = Date.now,
  ) {
    this.state = state;
    this.now = now;
    this.transport = transport;
    this.journal = journal;
    this.changed = changed;
    this.timeoutMs = timeoutMs;
  }

  async settled(): Promise<void> {
    await this.currentDrive;
    await this.writes;
  }

  async track(accounts?: RouteAccounts): Promise<void> {
    if (accounts) {
      if (
        !Object.values(accounts).every((value) => Number.isFinite(value) && value >= 0) ||
        accounts.revision <= (this.state.accounts?.revision ?? 0)
      )
        return;
      this.state = { ...this.state, accounts: { ...accounts } };
    }
    await this.persist();
  }

  async resume(repeatUntilStopped?: boolean): Promise<void> {
    if (["running"].includes(this.state.status)) return;
    await this.currentDrive;
    if (this.state.status === "running") return;
    if (repeatUntilStopped !== undefined) {
      const mission = {
        ...this.state.mission,
        repeatUntilStopped,
        repetitions: Math.max(this.state.mission.repetitions, this.state.lap + 1),
      };
      prepareMission(mission, this.state.runId);
      this.state = { ...this.state, mission };
    }
    this.state = resumeMission(this.state);
    if (this.state.status === "running") this.runningSince = this.now();
    this.changed(this.state);
    this.currentDrive = this.drive();
    await this.currentDrive;
  }

  async pause(reason?: string): Promise<void> {
    this.state = pauseMission(this.state, reason);
    this.controller?.abort();
    await this.persist();
  }

  async abort(): Promise<void> {
    this.state = abortMission(this.state);
    this.controller?.abort();
    await this.persist();
  }

  private async persist(): Promise<boolean> {
    if (this.runningSince !== undefined) {
      const now = this.now();
      this.state = {
        ...this.state,
        runningMs: (this.state.runningMs ?? 0) + Math.max(0, now - this.runningSince),
      };
      this.runningSince = this.state.status === "running" ? now : undefined;
    }
    this.changed(this.state);
    try {
      const snapshot = structuredClone(this.state);
      const write = this.writes.then(() => this.journal.save(snapshot));
      this.writes = write.catch(() => {});
      await write;
      return true;
    } catch {
      this.state = pauseMission(
        this.state,
        "Checkpoint could not be saved; automatic commands are stopped.",
      );
      this.changed(this.state);
      return false;
    }
  }

  private async drive(): Promise<void> {
    if (this.driving) return;
    this.driving = true;
    try {
      while (this.state.status === "running") {
        const issued = nextRouteOperation(this.state);
        this.state = issued.state;
        // Persist pending intent before dispatch. A crash cannot make it look unsent.
        if (!(await this.persist()) || this.state.status !== "running") return;
        if (!issued.operation) return;
        const controller = new AbortController();
        this.controller = controller;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const interrupted = new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("Operation interrupted; reconcile before continuing.")),
              { once: true },
            );
            timeout = setTimeout(() => controller.abort(), this.timeoutMs);
          });
          const result = await Promise.race([
            this.transport.execute(
              issued.operation,
              structuredClone(this.state),
              controller.signal,
            ),
            interrupted,
          ]);
          if (result.operationId !== issued.operation.id || result.runId !== issued.operation.runId)
            throw new Error("Transport returned an unrelated confirmation.");
          this.state = confirmRouteOperation(this.state, result);
        } catch (error) {
          if (this.state.status === "running")
            this.state = pauseMission(
              this.state,
              error instanceof Error ? error.message : "Operation outcome is uncertain.",
            );
        } finally {
          if (timeout) clearTimeout(timeout);
          this.controller = undefined;
        }
        if (!(await this.persist())) return;
      }
    } finally {
      this.driving = false;
    }
  }
}
