// Discovery queue load test: job creation throughput (estimate, credit hold, job document,
// orchestrator enqueue) at a fixed arrival rate, against the synthetic Overture catalogue the perf
// seed loads (PERF_OVERTURE_PLACES). Run a worker on the same Redis and QUEUE_PREFIX to measure
// processing; scripts in infra/load/README.md read completion times from MongoDB afterwards.
import http from "k6/http";
import { check } from "k6";
import { API, headers, signIn, uuid } from "./lib.js";

const RATE = Number(__ENV.RATE || 5);
const DURATION = __ENV.DURATION || "1m";

export const options = {
  scenarios: {
    enqueue: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 40,
    },
  },
  thresholds: {
    "http_req_failed{kind:enqueue}": ["rate<0.01"],
    "http_req_duration{kind:enqueue}": ["p(95)<1000"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
};

export function setup() {
  return { session: signIn() };
}

export default function (data) {
  const body = {
    name: `Load test ${uuid().slice(0, 8)}`,
    sources: ["overture_places"],
    location: { country: "NG", region: "Lagos", lga: "Ikeja" },
    categories: ["Pharmacy"],
    maxRecords: Number(__ENV.MAX_RECORDS || 5),
  };
  const res = http.post(`${API}/discovery/jobs`, JSON.stringify(body), {
    headers: headers(data.session, { "Idempotency-Key": uuid() }),
    tags: { kind: "enqueue", name: "create_job" },
  });
  check(res, { "job created": (r) => r.status === 201 });
}
