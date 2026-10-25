import { Badge, StatusIndicator } from "@leadforge/ui";

const ROWS = [
  {
    name: "Sample Bakery (Sample)",
    industry: "Bakery",
    city: "Ikeja",
    phone: "verified",
    email: "unverified",
    score: 82,
  },
  {
    name: "Sample Clinic (Sample)",
    industry: "Clinic",
    city: "Lekki",
    phone: "verified",
    email: "missing",
    score: 74,
  },
  {
    name: "Sample Laundry (Sample)",
    industry: "Laundry",
    city: "Yaba",
    phone: "unverified",
    email: "verified",
    score: 61,
  },
  {
    name: "Sample Auto (Sample)",
    industry: "Auto repair",
    city: "Surulere",
    phone: "missing",
    email: "missing",
    score: 38,
  },
] as const;

const TONE = { verified: "success", unverified: "warning", missing: "neutral" } as const;

/**
 * Static illustration of the directory. Every value is labelled sample data; nothing here
 * comes from or claims to be live platform data.
 */
export function InterfacePreview() {
  return (
    <figure className="border-border bg-surface min-w-0 overflow-hidden rounded-lg border shadow-md">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
        </div>
        <Badge variant="outline">Sample data</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <caption className="sr-only">Illustrative business directory with sample rows</caption>
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Business
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Industry
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Location
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Phone
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Email
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Fit
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.name} className="border-border border-t">
                <td className="px-3 py-2.5 font-medium">{row.name}</td>
                <td className="text-muted-foreground px-3 py-2.5">{row.industry}</td>
                <td className="text-muted-foreground px-3 py-2.5">{row.city}, Lagos</td>
                <td className="px-3 py-2.5">
                  <StatusIndicator
                    tone={TONE[row.phone]}
                    label={row.phone}
                    className="text-[13px]"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <StatusIndicator
                    tone={TONE[row.email]}
                    label={row.email}
                    className="text-[13px]"
                  />
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
        Illustration only. Businesses, contacts and scores shown here are fictional sample records.
      </figcaption>
    </figure>
  );
}
