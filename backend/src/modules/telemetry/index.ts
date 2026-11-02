// telemetry — the event log's and the analytics sink's public face.
//
// Writing to the event log is in infra (`recordEvent`), because every module
// and all three processes write. Reading it, the client-report and analytics
// endpoints, and the metrics read from the analytics views live here.

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
export {
  dailyActive,
  dailyMoney,
  funnel,
  recordAnalytics,
  retention,
  type Cohort,
  type DayActive,
  type DayMoney,
  type FunnelStep,
} from './analytics.service.js';
