import type { HolocronApi } from "../../types/telemetry";
import type {
  RouteCheckpoint,
  RouteConfirmation,
  RouteOperation,
} from "../../domain/routeAutopilot";
import type { RouteTransport } from "./RouteRunner";

export class MudletRouteTransport implements RouteTransport {
  private api: HolocronApi;
  constructor(api: HolocronApi) {
    this.api = api;
  }

  async stop(runId: string) {
    return this.api.sendIntent("route_stop", { runId });
  }

  execute(
    operation: RouteOperation,
    checkpoint: RouteCheckpoint,
    signal: AbortSignal,
  ): Promise<RouteConfirmation> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let intentId: string | undefined;
      const earlyRejections = new Map<string, string>();
      let offSnapshot = () => {};
      let offAck = () => {};
      const finish = (result?: RouteConfirmation, error?: string) => {
        if (settled) return;
        settled = true;
        offSnapshot();
        offAck();
        signal.removeEventListener("abort", abort);
        if (result) resolve(result);
        else reject(new Error(error ?? "Navigation interrupted."));
      };
      const abort = () => {
        void this.stop(operation.runId).catch(() => {});
        finish(undefined, "Stopped; an in-game maneuver already underway may still finish.");
      };
      if (signal.aborted) {
        finish(undefined, "Navigation cancelled.");
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      offSnapshot = this.api.onSnapshot((snapshot) => {
        const status = snapshot.metadata?.routeNavigation;
        if (status?.operationId !== operation.id || status.runId !== operation.runId) return;
        if (status.status === "blocked") finish(undefined, status.reason);
        if (status.status === "completed" && status.confirmation) finish(status.confirmation);
      });
      offAck = this.api.onIntentAck((ack) => {
        if (ack.status !== "rejected" || !ack.id) return;
        const reason = ack.reason ?? "Mudlet rejected the operation.";
        if (ack.id === intentId) finish(undefined, reason);
        else earlyRejections.set(ack.id, reason);
      });
      void this.api
        .sendIntent("route_operation", {
          operation,
          ship: checkpoint.mission.ship,
          manualRoute: checkpoint.mission.routingMode === "manual",
          maxDistance: checkpoint.mission.maxDistance,
          interrupted: checkpoint.interrupted,
          from: checkpoint.mission.stops[Math.max(0, checkpoint.stop - 1)].destination,
        })
        .then((sent) => {
          intentId = sent.id;
          if (!sent.accepted)
            finish(undefined, sent.reason ?? "Could not send navigation operation.");
          else if (sent.id && earlyRejections.has(sent.id))
            finish(undefined, earlyRejections.get(sent.id));
        })
        .catch((error: unknown) =>
          finish(undefined, error instanceof Error ? error.message : "Connection failed."),
        );
    });
  }
}
