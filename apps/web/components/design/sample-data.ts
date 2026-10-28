import type { FieldState } from "@leadforge/ui";

/** Fictional records for the gallery. Every name says "(Sample)"; domains use the reserved .example TLD. */
export interface SampleBusiness {
  id: string;
  name: string;
  industry: string;
  city: string;
  phone: FieldState;
  email: FieldState;
  website: string | null;
  score: number;
  source: string;
}

const NAMES = [
  ["Adunni Bakery", "Bakery", "Ikeja"],
  ["Lekki Family Clinic", "Clinic", "Lekki"],
  ["Yaba Fresh Laundry", "Laundry", "Yaba"],
  ["Surulere Auto Care", "Auto repair", "Surulere"],
  ["Ajah Smiles Dental", "Dental clinic", "Ajah"],
  ["Ikoyi Print House", "Printing", "Ikoyi"],
  ["Maryland Grill", "Restaurant", "Maryland"],
  ["Festac Tailoring Studio", "Tailoring", "Festac"],
  ["Gbagada Fitness Hub", "Gym", "Gbagada"],
  ["Ojota Phone Repairs", "Electronics repair", "Ojota"],
  ["Magodo Kids Academy", "School", "Magodo"],
  ["Victoria Island Florist", "Florist", "Victoria Island"],
  ["Ilupeju Pharmacy", "Pharmacy", "Ilupeju"],
  ["Ogba Event Rentals", "Event rentals", "Ogba"],
  ["Apapa Freight Desk", "Logistics", "Apapa"],
  ["Ketu Hair Lounge", "Salon", "Ketu"],
  ["Oshodi Spare Parts", "Auto parts", "Oshodi"],
  ["Anthony Village Bookshop", "Bookshop", "Anthony"],
  ["Ebute Metta Water Works", "Water supply", "Ebute Metta"],
  ["Isolo Furniture Makers", "Furniture", "Isolo"],
  ["Agege Bread Depot", "Bakery", "Agege"],
  ["Ikorodu Solar Installers", "Solar installation", "Ikorodu"],
  ["Mushin Shoe Clinic", "Shoe repair", "Mushin"],
] as const;

const STATES: FieldState[] = [
  "verified",
  "unverified",
  "stale",
  "missing",
  "conflicting",
  "expired",
];
const SOURCES = ["Places API (Sample)", "Business website (Sample)", "CSV import (Sample)"];

export const SAMPLE_BUSINESSES: SampleBusiness[] = NAMES.map(([name, industry, city], i) => ({
  id: `sample-${i + 1}`,
  name: `${name} (Sample)`,
  industry,
  city: `${city}, Lagos`,
  phone: STATES[i % STATES.length] ?? "missing",
  email: STATES[(i + 2) % STATES.length] ?? "missing",
  website: i % 4 === 3 ? null : `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example`,
  score: 92 - ((i * 7) % 61),
  source: SOURCES[i % SOURCES.length] ?? "CSV import (Sample)",
}));

export const INDUSTRY_OPTIONS = Array.from(new Set(NAMES.map(([, industry]) => industry)))
  .sort()
  .map((industry) => ({ value: industry.toLowerCase().replace(/\s+/g, "-"), label: industry }));

export const CITY_OPTIONS = [
  { value: "ikeja", label: "Ikeja, Lagos" },
  { value: "lekki", label: "Lekki, Lagos" },
  { value: "yaba", label: "Yaba, Lagos" },
  { value: "surulere", label: "Surulere, Lagos" },
  { value: "abuja-wuse", label: "Wuse, Abuja" },
  { value: "port-harcourt", label: "Port Harcourt, Rivers" },
  { value: "ibadan", label: "Ibadan, Oyo" },
];
