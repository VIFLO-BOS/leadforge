import { Plus } from "lucide-react";
import { cn } from "@leadforge/ui";

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

/** Native disclosure list: works without JS, keyboard and screen-reader friendly. */
export function Faq({
  items = FAQ_ITEMS,
  className,
}: {
  items?: typeof FAQ_ITEMS;
  className?: string;
}) {
  return (
    <div className={cn("border-border mx-auto max-w-4xl border-t", className)}>
      {items.map((item) => (
        <details key={item.q} className="border-border group border-b">
          <summary className="state-layer transition-ui -mx-3 flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-3 py-5 text-left sm:py-6 [&::-webkit-details-marker]:hidden">
            <span className="break-anywhere text-base font-normal leading-snug">{item.q}</span>
            <span className="bg-surface-container-high text-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
              <Plus
                aria-hidden
                className="ease-emphasized size-5 transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none"
              />
            </span>
          </summary>
          <p className="text-muted-foreground max-w-3xl pb-6 pr-12 text-sm leading-relaxed">
            {item.a}
          </p>
        </details>
      ))}
    </div>
  );
}
