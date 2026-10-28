import { DATA_LICENSES } from "@leadforge/contracts";
import type { Metadata } from "next";
import { fetchDataLicenses } from "@/lib/data-licenses";

export const metadata: Metadata = {
  title: "Data sources and licences",
  description:
    "The open data sources LeadForge uses, the attribution each requires, and the licences that apply.",
};

/**
 * Data sources and licences (/legal/data-sources), rendered from GET /public/data-licenses: each
 * source's attribution and upstream datasets, every licence with its full text and canonical
 * page, notices reproduced in full, LeadForge's modifications and the disclaimer.
 */
export default async function DataSourcesPage() {
  const result = await fetchDataLicenses();
  const data = result.ok ? result.data : null;
  const licenses =
    data?.licenses ??
    Object.values(DATA_LICENSES).map((l) => ({ ...l, appliesTo: "", textAvailable: true }));

  return (
    <>
      <h1 className="text-h1 mb-6 text-balance">Data sources and licences</h1>
      <p>
        LeadForge shows where every business value came from. Data collected from open datasets is
        used under the licences below, and wherever it appears in the product it carries its
        source&apos;s attribution.
      </p>
      <p>
        Businesses found through discovery come from Overture Maps Places. Wherever they appear,
        LeadForge shows &ldquo;Source: Overture Maps Foundation (overturemaps.org)&rdquo; with the
        record&apos;s dataset line, for example &ldquo;Data from Meta. Available under CDLA
        Permissive 2.0.&rdquo; Records from Foursquare are under Apache 2.0 with Foursquare&apos;s
        notice, and records from AllThePlaces under CC0 1.0. State and LGA names are assigned with
        Overture&apos;s division boundaries, which credit OpenStreetMap contributors (ODbL) and
        geoBoundaries and Esri Community Maps contributors (CC BY 4.0); LeadForge stores the names,
        not the boundaries. Google Places is not used.
      </p>
      {data?.overtureRelease ? (
        <p>
          Overture Maps Places release currently loaded: <code>{data.overtureRelease}</code>.
        </p>
      ) : null}
      {!data ? (
        <p role="status">
          The live list of data sources could not be loaded right now, so only the licences this
          version of LeadForge knows about are listed. Try again later for each source&apos;s
          attribution and notices.
        </p>
      ) : null}

      {data?.sources.length ? (
        <>
          <h2>Sources</h2>
          {data.sources.map((s) => (
            <section key={s.source} aria-labelledby={`source-${s.source}`}>
              <h3 id={`source-${s.source}`}>{s.name}</h3>
              <p>{s.licensing.text}</p>
              {s.licensing.url ? (
                <p>
                  <a href={s.licensing.url} rel="noopener noreferrer" target="_blank">
                    {s.licensing.url}
                  </a>
                </p>
              ) : null}
              {s.licensing.upstream.length ? (
                <>
                  <p>Upstream datasets and their attribution:</p>
                  <ul>
                    {s.licensing.upstream.map((u) => (
                      <li key={`${u.dataset}-${u.license}`}>
                        <strong>{u.dataset}</strong>: {u.text} (
                        <a href={`#license-${u.license}`}>{u.license}</a>)
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {s.licensing.requirements.length ? (
                <>
                  <p>How LeadForge meets the licence terms:</p>
                  <ul>
                    {s.licensing.requirements.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ))}
        </>
      ) : null}

      <h2>Licences</h2>
      <ul>
        {licenses.map((l) => (
          <li key={l.id} id={`license-${l.id}`} className="scroll-mt-28">
            <strong>{l.name}</strong> ({l.id}){l.appliesTo ? <>: {l.appliesTo}</> : null}
            <br />
            {l.textAvailable ? (
              <>
                <a href={l.textPath}>Full text</a> ·{" "}
              </>
            ) : null}
            <a href={l.referenceUrl} rel="noopener noreferrer" target="_blank">
              Licence page
            </a>
          </li>
        ))}
      </ul>

      {data?.notices.length ? (
        <>
          <h2>Notices</h2>
          {data.notices.map((n) => (
            <section key={n.id} aria-labelledby={`notice-${n.id}`}>
              <h3 id={`notice-${n.id}`}>{n.title}</h3>
              <p>
                Applies to: {n.appliesTo}. <a href={n.url}>Plain-text notice</a>
              </p>
              <details>
                <summary>Show the full notice</summary>
                <pre className="whitespace-pre-wrap break-words text-xs">{n.text}</pre>
              </details>
            </section>
          ))}
        </>
      ) : null}

      {data ? (
        <>
          <h2>Changes LeadForge makes to the data</h2>
          <p>{data.modifications}</p>
          <h2>Disclaimer</h2>
          <p>{data.disclaimer}</p>
        </>
      ) : null}
    </>
  );
}
