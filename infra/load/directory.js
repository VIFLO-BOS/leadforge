// Directory load test: list, filter, search and sort pages, the second page through the cursor,
// facets and business detail, against an organization with ~100k businesses (pnpm perf seed).
// Target (ARCHITECTURE.md section 10): p95 under 300 ms for list endpoints at 100k businesses.
//
//   docker run --rm -v "$PWD/infra/load:/scripts:ro" -v "$PWD/.k6:/out" \
//     -e BASE_URL=http://host.docker.internal:4200 -e PASSWORD=... \
//     grafana/k6:1.3.0 run /scripts/directory.js --summary-export /out/directory.json
import http from "k6/http";
import { check } from "k6";
import { API, headers, signIn } from "./lib.js";

const VUS = Number(__ENV.VUS || 8);
const DURATION = __ENV.DURATION || "2m";

const LISTS = [
  ["list_default", "/businesses?pageSize=50"],
  [
    "filter_category_region_site",
    "/businesses?category=Pharmacy&region=Lagos&hasWebsite=true&pageSize=50",
  ],
  ["filter_locality_email", "/businesses?region=Kano&locality=Kano&hasEmail=true&pageSize=50"],
  ["filter_states", "/businesses?websiteState=unverified&emailState=unverified&pageSize=50"],
  ["search_prefix", "/businesses?q=golden&pageSize=50"],
  ["search_two_words", "/businesses?q=royal%20bakery&pageSize=50"],
  ["sort_name", "/businesses?sort=name:asc&pageSize=50"],
  ["sort_created", "/businesses?sort=createdAt:asc&pageSize=50"],
  ["sort_fit", "/businesses?sort=fit:desc&pageSize=50"],
  ["filter_sort_name", "/businesses?region=Lagos&sort=name:asc&pageSize=50"],
];

// One threshold per request type, so the summary reports each type's p95 separately.
const perName = {};
for (const [name] of LISTS.concat([["page2"]]))
  perName[`http_req_duration{name:${name}}`] = ["p(95)<300"];

export const options = {
  scenarios: {
    directory: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  thresholds: Object.assign(
    {
      // Release target for list endpoints (ARCHITECTURE.md section 10).
      "http_req_duration{kind:list}": ["p(95)<300"],
      "http_req_duration{kind:detail}": ["p(95)<300"],
      "http_req_duration{kind:facets}": ["p(95)<1000"],
      "http_req_failed{kind:list}": ["rate<0.01"],
      "http_req_failed{kind:detail}": ["rate<0.01"],
    },
    perName,
  ),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
};

export function setup() {
  const session = signIn();
  // Detail ids: the first 200 of the default listing.
  const ids = [];
  let cursor = null;
  for (let i = 0; i < 2; i++) {
    const res = http.get(
      `${API}/businesses?pageSize=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { headers: headers(session), tags: { kind: "setup" } },
    );
    const body = res.json();
    for (const row of body.data) ids.push(row.id);
    cursor = body.meta.nextCursor;
  }
  return { session, ids };
}

export default function (data) {
  const h = { headers: headers(data.session) };
  const [name, path] = LISTS[Math.floor(Math.random() * LISTS.length)];
  const first = http.get(`${API}${path}`, Object.assign({ tags: { kind: "list", name } }, h));
  check(first, { "list 200": (r) => r.status === 200 });
  // Every third iteration reads the next page through the cursor (no total on later pages).
  if (first.status === 200 && Math.random() < 0.34) {
    const next = first.json().meta.nextCursor;
    if (next) {
      const page2 = http.get(
        `${API}${path}&cursor=${encodeURIComponent(next)}`,
        Object.assign({ tags: { kind: "list", name: "page2" } }, h),
      );
      check(page2, { "page 2 200": (r) => r.status === 200 });
    }
  }
  const id = data.ids[Math.floor(Math.random() * data.ids.length)];
  const detail = http.get(
    `${API}/businesses/${id}`,
    Object.assign({ tags: { kind: "detail", name: "detail" } }, h),
  );
  check(detail, { "detail 200": (r) => r.status === 200 });
  if (Math.random() < 0.1) {
    const facets = http.get(
      `${API}/businesses/facets`,
      Object.assign({ tags: { kind: "facets", name: "facets" } }, h),
    );
    check(facets, { "facets 200": (r) => r.status === 200 });
  }
}
