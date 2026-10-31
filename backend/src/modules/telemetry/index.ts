// telemetry — the event log's public face.
//
// Writing is in infra (`recordEvent`), because every module and all three
// processes write. Reading and the client-report endpoint live here.

export { buildTelemetryRouter } from './telemetry.routes.js';
export {
  eventCounts,
  listEvents,
  topFingerprints,
  type EventCounts,
  type EventFilter,
  type FingerprintGroup,
  type SystemEvent,
} from './events.query.js';
