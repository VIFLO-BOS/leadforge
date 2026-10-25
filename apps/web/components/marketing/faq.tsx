import { ChevronDown } from "lucide-react";

export const FAQ_ITEMS = [
  {
    q: "Where does the business data come from?",
    a: "From sources we have reviewed and are permitted to use: official APIs, publicly accessible business websites fetched within their robots directives, and files you import yourself. Every field shows its source and collection date. We do not scrape social networks, marketplaces or login-walled sites.",
  },
  {
    q: "Will you find every business in my city?",
    a: "No, and we will not pretend to. Coverage depends on the sources enabled for your workspace. The Sources page shows exactly which sources were used and their known limitations.",
  },
  {
    q: "How do you know a number is on WhatsApp?",
    a: "We only mark WhatsApp when there is explicit evidence, such as a wa.me link or a WhatsApp label on the business's own website, or when someone on your team confirms it after making contact. We never guess.",
  },
  {
    q: "What does the lead score mean?",
    a: "It measures how well a business matches the criteria you configure: contact completeness, verification, website opportunities, industry and location. It is explained signal by signal and it is not a prediction that anyone will buy.",
  },
  {
    q: "Can a business ask to be removed?",
    a: "Yes. Businesses can request correction or removal through our data collection page. Removal requests apply across all workspaces and we aim to handle them within 30 days.",
  },
  {
    q: "How is billing handled?",
    a: "Subscriptions and credit packs are paid through Paystack. Credits are reserved when a job is queued and settled against what the job actually produced, so failed work is not charged.",
  },
];

export function Faq() {
  return (
    <div className="divide-border border-border bg-surface mx-auto max-w-3xl divide-y rounded-lg border">
      {FAQ_ITEMS.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-left text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="break-anywhere">{item.q}</span>
            <ChevronDown
              aria-hidden
              className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="text-muted-foreground px-4 pb-4 text-sm">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
