import { normalizeKey, searchWords } from "../normalization/index.js";

/**
 * LeadForge category vocabulary for Overture Maps Places (taxonomy of schema v2.0.0, release
 * 2026-10-21.0). Overture ids are snake_case nodes; a place's `taxonomy.hierarchy` lists every
 * ancestor, so a node matches its whole subtree (`pharmacy_and_drug_store` matches `pharmacy`).
 *
 * Built from the Nigerian node counts (research CSVs ng_taxonomy_nodes / ng_taxonomy_paths).
 * Common Nigerian words with no node of that name ("supermarket", "chemist", "filling station",
 * "POS agent") are mapped here. Revalidate at each quarterly taxonomy release: a mapped node with
 * no places in a new snapshot is reported by the sync (`warnings`).
 */
export interface CuratedCategory {
  key: string;
  label: string;
  synonyms: string[];
  nodes: string[];
}

export const OVERTURE_TAXONOMY_VERSION = "overture-2.0.0/leadforge-ng-1";

export const CURATED_CATEGORIES: CuratedCategory[] = [
  {
    key: "pharmacy",
    label: "Pharmacy",
    synonyms: [
      "chemist",
      "drug store",
      "drugstore",
      "patent medicine store",
      "patent medicine vendor",
    ],
    nodes: ["pharmacy_and_drug_store"],
  },
  {
    key: "hospital",
    label: "Hospital",
    synonyms: ["hospitals", "medical centre", "medical center"],
    nodes: ["hospital"],
  },
  {
    key: "clinic",
    label: "Clinic",
    synonyms: ["health centre", "health center", "medical clinic", "doctor", "doctors"],
    nodes: ["outpatient_care_facility", "doctors_office", "primary_care_or_general_clinic"],
  },
  {
    key: "dental_clinic",
    label: "Dental clinic",
    synonyms: ["dentist", "dental"],
    nodes: ["dental_clinic", "general_dentistry", "cosmetic_dentistry", "pediatric_dentistry"],
  },
  {
    key: "diagnostic_lab",
    label: "Diagnostic laboratory",
    synonyms: [
      "laboratory",
      "medical lab",
      "diagnostic centre",
      "diagnostic center",
      "scan centre",
    ],
    nodes: ["diagnostics_imaging_or_lab_service", "laboratory_testing"],
  },
  {
    key: "supermarket",
    label: "Supermarket",
    synonyms: [
      "grocery",
      "groceries",
      "provision store",
      "provisions",
      "mini mart",
      "minimart",
      "superstore",
    ],
    nodes: ["grocery_store", "warehouse_club_store", "superstore", "convenience_store"],
  },
  {
    key: "restaurant",
    label: "Restaurant",
    synonyms: ["eatery", "buka", "bukka", "mama put", "chop bar", "canteen", "food joint"],
    nodes: ["restaurant", "casual_eatery"],
  },
  {
    key: "fast_food",
    label: "Fast food",
    synonyms: ["quick service restaurant", "qsr", "fast food restaurant"],
    nodes: ["fast_food_restaurant"],
  },
  {
    key: "bakery",
    label: "Bakery",
    synonyms: ["bread", "confectionery", "cake shop", "cakes"],
    nodes: ["bakery"],
  },
  {
    key: "caterer",
    label: "Caterer",
    synonyms: ["catering", "food vendor", "small chops"],
    nodes: ["caterer", "food_service"],
  },
  {
    key: "bar_lounge",
    label: "Bar or lounge",
    synonyms: ["bar", "lounge", "club", "nightclub", "night club", "beer parlour", "pub"],
    nodes: ["bar", "lounge", "nightlife_venue", "alcoholic_beverage_venue"],
  },
  {
    key: "hotel",
    label: "Hotel",
    synonyms: ["hotels", "guest house", "guesthouse", "motel", "inn", "lodge"],
    nodes: ["hotel", "lodging"],
  },
  {
    key: "event_centre",
    label: "Event centre",
    synonyms: ["event center", "event hall", "event venue", "hall", "banquet hall", "events"],
    nodes: ["event_venue", "event_or_party_service", "party_and_event_planning"],
  },
  {
    key: "event_planner",
    label: "Event planner",
    synonyms: ["event planning", "wedding planner", "decorator", "party planner"],
    nodes: ["party_and_event_planning", "wedding_planning"],
  },
  {
    key: "lawyer",
    label: "Lawyer",
    synonyms: [
      "law firm",
      "solicitor",
      "barrister",
      "legal practitioner",
      "attorney",
      "chambers",
      "legal",
    ],
    nodes: ["legal_service", "attorney_or_law_firm"],
  },
  {
    key: "accountant",
    label: "Accountant",
    synonyms: [
      "accounting firm",
      "chartered accountant",
      "auditor",
      "audit firm",
      "tax consultant",
      "bookkeeping",
    ],
    nodes: ["accountant"],
  },
  {
    key: "bank",
    label: "Bank",
    synonyms: ["banks", "microfinance bank", "mfb", "credit union"],
    nodes: ["bank_or_credit_union"],
  },
  {
    key: "pos_agent",
    label: "POS agent or money transfer",
    synonyms: ["pos", "pos agent", "pos point", "mobile money", "money transfer", "agent banking"],
    nodes: ["money_transfer_service", "financial_service"],
  },
  {
    key: "bureau_de_change",
    label: "Bureau de change",
    synonyms: ["bdc", "forex", "currency exchange", "money changer"],
    nodes: ["currency_exchange"],
  },
  {
    key: "insurance",
    label: "Insurance",
    synonyms: ["insurance company", "insurance agent", "insurance broker"],
    nodes: ["insurance_agency", "health_insurance_office"],
  },
  {
    key: "loan",
    label: "Loans and credit",
    synonyms: ["loan", "loan company", "lender", "microcredit"],
    nodes: ["installment_loans", "credit_and_debt_counseling", "financial_advising"],
  },
  {
    key: "filling_station",
    label: "Filling station",
    synonyms: ["petrol station", "fuel station", "gas station", "petrol", "fuel", "mega station"],
    nodes: ["fueling_station"],
  },
  {
    key: "car_dealer",
    label: "Car dealer",
    synonyms: [
      "car dealership",
      "auto dealer",
      "car sales",
      "motor dealer",
      "used cars",
      "tokunbo cars",
    ],
    nodes: ["auto_dealer", "used_auto_dealer", "vehicle_dealer"],
  },
  {
    key: "mechanic",
    label: "Mechanic",
    synonyms: [
      "auto repair",
      "car repair",
      "workshop",
      "garage",
      "panel beater",
      "vulcanizer",
      "auto mechanic",
    ],
    nodes: [
      "automotive_repair",
      "automotive_service",
      "auto_body_shop",
      "tire_dealer_and_repair",
      "tire_shop",
    ],
  },
  {
    key: "spare_parts",
    label: "Auto spare parts",
    synonyms: ["spare parts", "auto parts", "car parts"],
    nodes: ["auto_parts_store"],
  },
  {
    key: "car_rental",
    label: "Car hire",
    synonyms: ["car rental", "car hire", "car leasing"],
    nodes: ["car_rental_service", "auto_leasing"],
  },
  {
    key: "logistics",
    label: "Logistics",
    synonyms: [
      "logistics company",
      "haulage",
      "freight",
      "cargo",
      "clearing and forwarding",
      "freight forwarder",
      "shipping",
    ],
    nodes: [
      "freight_and_cargo_service",
      "b2b_transportation_and_storage_service",
      "freight_forwarding_agency",
      "shipping_center",
      "vehicle_shipping",
    ],
  },
  {
    key: "courier",
    label: "Courier and delivery",
    synonyms: ["courier", "dispatch", "dispatch rider", "delivery", "delivery service"],
    nodes: ["shipping_or_delivery_service", "food_delivery_service"],
  },
  {
    key: "travel_agency",
    label: "Travel agency",
    synonyms: ["travel agent", "travel and tours", "tour operator", "visa agent", "ticketing"],
    nodes: ["travel_service", "travel_company", "travel_agent", "sightseeing_tour_agency"],
  },
  {
    key: "school",
    label: "School",
    synonyms: [
      "schools",
      "nursery school",
      "primary school",
      "secondary school",
      "college",
      "academy",
    ],
    nodes: ["school", "preschool", "day_care_preschool"],
  },
  {
    key: "university",
    label: "University or polytechnic",
    synonyms: ["university", "polytechnic", "college of education", "tertiary institution"],
    nodes: ["college_university"],
  },
  {
    key: "training",
    label: "Training and tutoring",
    synonyms: [
      "tutorial centre",
      "tutorial center",
      "lesson teacher",
      "training centre",
      "computer school",
      "skills acquisition",
    ],
    nodes: [
      "educational_service",
      "tutoring_service",
      "specialty_school",
      "computer_coaching",
      "vocational_and_technical_school",
    ],
  },
  {
    key: "church",
    label: "Church",
    synonyms: ["churches", "parish", "ministry", "cathedral", "chapel", "assembly"],
    nodes: ["christian_place_of_worship"],
  },
  {
    key: "mosque",
    label: "Mosque",
    synonyms: ["mosques", "masjid", "jumat mosque", "islamic centre"],
    nodes: ["muslim_place_of_worship"],
  },
  {
    key: "religious_organization",
    label: "Religious organization",
    synonyms: ["religious", "faith based organization", "fellowship"],
    nodes: ["religious_organization", "place_of_worship"],
  },
  {
    key: "ngo",
    label: "NGO or non-profit",
    synonyms: ["ngo", "non profit", "nonprofit", "charity", "foundation", "community organization"],
    nodes: ["non_governmental_association", "social_or_community_service", "civic_organization"],
  },
  {
    key: "government_office",
    label: "Government office",
    synonyms: ["government", "ministry office", "agency office", "local government secretariat"],
    nodes: ["government_office"],
  },
  {
    key: "beauty_salon",
    label: "Beauty salon",
    synonyms: [
      "salon",
      "hair salon",
      "beauty parlour",
      "beauty parlor",
      "makeup artist",
      "nail salon",
      "spa",
    ],
    nodes: [
      "personal_or_beauty_service",
      "beauty_salon",
      "hair_salon",
      "nail_salon",
      "makeup_artist",
      "spa",
    ],
  },
  {
    key: "barber",
    label: "Barber",
    synonyms: ["barbing salon", "barber shop", "barbershop"],
    nodes: ["barber"],
  },
  {
    key: "gym",
    label: "Gym and fitness",
    synonyms: ["gym", "fitness centre", "fitness center", "fitness", "health club"],
    nodes: ["gym", "sport_or_fitness_facility", "fitness_studio", "fitness_trainer"],
  },
  {
    key: "fashion",
    label: "Fashion and clothing",
    synonyms: [
      "boutique",
      "clothing",
      "clothes",
      "fashion store",
      "fashion house",
      "tailor",
      "fashion designer",
    ],
    nodes: ["fashion_and_apparel_store", "clothing_company", "custom_clothing_store"],
  },
  {
    key: "shoe_store",
    label: "Shoe store",
    synonyms: ["shoes", "footwear"],
    nodes: ["shoe_store"],
  },
  {
    key: "fabric_store",
    label: "Fabric store",
    synonyms: ["fabrics", "textiles", "ankara", "lace"],
    nodes: ["fabric_store"],
  },
  {
    key: "phone_store",
    label: "Phone and gadget store",
    synonyms: [
      "phone shop",
      "phones",
      "gadgets",
      "mobile phones",
      "phone accessories",
      "phone repair",
    ],
    nodes: ["mobile_phone_store", "mobile_phone_accessory_store", "mobile_phone_repair"],
  },
  {
    key: "electronics",
    label: "Electronics store",
    synonyms: ["electronics", "home appliances", "appliance store"],
    nodes: ["electronics_store"],
  },
  {
    key: "computer_store",
    label: "Computer store",
    synonyms: ["computers", "laptops", "computer shop", "computer repair"],
    nodes: ["computer_store", "it_service_and_computer_repair"],
  },
  {
    key: "it_company",
    label: "IT and software company",
    synonyms: [
      "software",
      "software company",
      "tech company",
      "it company",
      "it services",
      "web design",
      "app developer",
    ],
    nodes: [
      "information_technology_company",
      "software_development",
      "web_designer",
      "it_consultant",
      "web_hosting_service",
    ],
  },
  {
    key: "telecoms",
    label: "Telecoms and internet provider",
    synonyms: ["telecom", "telecommunications", "internet service provider", "isp"],
    nodes: ["telecommunications_company"],
  },
  {
    key: "marketing_agency",
    label: "Marketing and advertising agency",
    synonyms: [
      "advertising",
      "marketing",
      "digital marketing",
      "branding",
      "pr agency",
      "social media agency",
    ],
    nodes: [
      "b2b_advertising_and_marketing_service",
      "marketing_agency",
      "advertising_agency",
      "internet_marketing_service",
      "social_media_agency",
      "media_agency",
    ],
  },
  {
    key: "printing",
    label: "Printing press",
    synonyms: [
      "printing",
      "printer",
      "printing press",
      "branding and printing",
      "t-shirt printing",
    ],
    nodes: ["printing_service", "screen_printing_service", "t_shirt_printing_service"],
  },
  {
    key: "media",
    label: "Media and broadcasting",
    synonyms: [
      "media house",
      "radio station",
      "tv station",
      "newspaper",
      "blog",
      "production company",
    ],
    nodes: ["media_service", "media_news_company", "broadcasting_media_production", "print_media"],
  },
  {
    key: "photography",
    label: "Photography studio",
    synonyms: ["photographer", "photo studio", "studio", "videographer"],
    nodes: ["photography_service", "event_photography_service", "session_photography_service"],
  },
  {
    key: "real_estate",
    label: "Real estate",
    synonyms: ["estate agent", "property", "realtor", "real estate agent", "property developer"],
    nodes: [
      "real_estate_service",
      "real_estate_agent",
      "property_management",
      "commercial_real_estate",
      "real_estate_investment",
      "home_developer",
    ],
  },
  {
    key: "construction",
    label: "Construction and building",
    synonyms: [
      "construction company",
      "contractor",
      "builder",
      "building contractor",
      "civil engineering",
    ],
    nodes: ["building_or_construction_service", "builder", "engineering_service"],
  },
  {
    key: "building_materials",
    label: "Building materials",
    synonyms: [
      "building materials",
      "hardware",
      "hardware store",
      "cement",
      "tiles",
      "plumbing materials",
      "electrical materials",
    ],
    nodes: [
      "hardware_home_and_garden_store",
      "building_supply_store",
      "hardware_store",
      "home_improvement_store",
      "electrical_supply_store",
    ],
  },
  {
    key: "furniture",
    label: "Furniture",
    synonyms: [
      "furniture store",
      "furniture maker",
      "carpenter",
      "interior decor",
      "interior design",
    ],
    nodes: ["furniture_store", "furniture_manufacturer", "interior_design"],
  },
  {
    key: "electrician_plumber",
    label: "Electrician or plumber",
    synonyms: ["electrician", "plumber", "plumbing", "solar installer", "inverter"],
    nodes: ["electrician", "plumbing"],
  },
  {
    key: "cleaning",
    label: "Cleaning and laundry",
    synonyms: [
      "laundry",
      "dry cleaner",
      "dry cleaning",
      "cleaning company",
      "fumigation",
      "pest control",
    ],
    nodes: [
      "laundry_service",
      "dry_cleaning",
      "home_cleaning",
      "cleaning_service",
      "pest_control_service",
    ],
  },
  {
    key: "security",
    label: "Security company",
    synonyms: ["security", "guard services", "cctv"],
    nodes: ["security_service", "security_systems", "home_security"],
  },
  {
    key: "agriculture",
    label: "Agriculture and farming",
    synonyms: ["farm", "farming", "poultry", "fish farm", "agro", "agro allied", "agribusiness"],
    nodes: [
      "agriculture",
      "agricultural_service",
      "farm",
      "b2b_agriculture_service",
      "poultry_farm",
      "fish_farm",
    ],
  },
  {
    key: "manufacturer",
    label: "Manufacturer",
    synonyms: ["manufacturing", "factory", "producer", "industry"],
    nodes: ["manufacturer"],
  },
  {
    key: "distributor",
    label: "Supplier or distributor",
    synonyms: ["supplier", "distributor", "wholesaler", "wholesale", "importer"],
    nodes: ["supplier_or_distributor", "food_beverage_distributor"],
  },
  {
    key: "water",
    label: "Water company",
    synonyms: ["water", "table water", "pure water", "sachet water", "borehole"],
    nodes: ["bottled_water_company", "b2b_water_treatment_service", "water_utility_provider"],
  },
  {
    key: "energy",
    label: "Energy and oil and gas",
    synonyms: ["oil and gas", "energy", "power", "solar"],
    nodes: [
      "energy_company",
      "b2b_energy_and_utility_service",
      "b2b_oil_and_gas",
      "electric_utility_provider",
    ],
  },
  {
    key: "shopping_mall",
    label: "Shopping mall",
    synonyms: ["mall", "plaza", "shopping complex", "shopping centre", "shopping center"],
    nodes: ["shopping_mall"],
  },
  {
    key: "market",
    label: "Market",
    synonyms: ["markets", "open market"],
    nodes: ["market", "farmers_market", "flea_market"],
  },
  {
    key: "bookstore",
    label: "Bookshop",
    synonyms: ["bookshop", "books", "stationery"],
    nodes: ["bookstore", "books_music_and_video_store"],
  },
  {
    key: "cosmetics",
    label: "Cosmetics and beauty supply",
    synonyms: ["cosmetics", "beauty supply", "skin care", "skincare", "perfume"],
    nodes: ["personal_care_and_beauty_store", "beauty_supply_store", "skin_care_and_makeup"],
  },
  {
    key: "jewelry",
    label: "Jewellery store",
    synonyms: ["jewellery", "jewelry", "gold"],
    nodes: ["jewelry_store"],
  },
  {
    key: "recruitment",
    label: "Recruitment agency",
    synonyms: ["recruitment", "employment agency", "staffing", "hr consultant"],
    nodes: ["employment_agency"],
  },
  {
    key: "consulting",
    label: "Business consulting",
    synonyms: ["consultant", "consulting", "consultancy", "management consultant"],
    nodes: ["business_consulting", "b2b_office_and_professional_service", "professional_service"],
  },
  {
    key: "driving_school",
    label: "Driving school",
    synonyms: ["driving school", "driving lessons"],
    nodes: ["driving_school"],
  },
];

const STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "of",
  "in",
  "a",
  "an",
  "for",
  "shop",
  "store",
  "services",
  "service",
  "company",
  "ltd",
  "limited",
  "nig",
  "nigeria",
]);

/** Lowercase, diacritic-free phrase with single spaces and simple plurals removed per word. */
export function categoryPhrase(term: string): string {
  return searchWords(term.replace(/[-_/&]+/g, " "))
    .map(singular)
    .join(" ");
}

function singular(word: string): string {
  if (word.length <= 3 || word.endsWith("ss") || word.endsWith("us")) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

const CURATED_BY_PHRASE = new Map<string, CuratedCategory>();
for (const c of CURATED_CATEGORIES) {
  for (const phrase of [c.key.replace(/_/g, " "), c.label, ...c.synonyms]) {
    const p = categoryPhrase(phrase);
    if (p && !CURATED_BY_PHRASE.has(p)) CURATED_BY_PHRASE.set(p, c);
  }
}

export interface ResolvedCategory {
  /** The term as given in the spec. */
  term: string;
  label: string;
  /** Overture taxonomy nodes the term covers (empty for a name-only match). */
  nodes: string[];
  /** Name words matched when no category fits (lower relevance); null when nodes match. */
  nameWords: string[] | null;
  via: "curated" | "taxonomy" | "name";
}

/**
 * Maps a spec category or keyword to Overture taxonomy nodes: the curated Nigerian vocabulary
 * first, then an Overture node of the same name ("beauty salon" is `beauty_salon`), then nodes
 * ending in the term ("school" also finds `driving_school`). Anything else falls back to words in
 * the place name. `vocabulary` is the set of nodes present in the loaded snapshot (null skips the
 * taxonomy lookups, e.g. before the first sync).
 */
export function resolveCategory(
  term: string,
  vocabulary: ReadonlySet<string> | null,
): ResolvedCategory {
  const phrase = categoryPhrase(term);
  const curated = CURATED_BY_PHRASE.get(phrase);
  if (curated)
    return {
      term,
      label: curated.label,
      nodes: [...curated.nodes],
      nameWords: null,
      via: "curated",
    };
  const snake = phrase.replace(/ /g, "_");
  const raw = normalizeKey(term)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (vocabulary) {
    for (const candidate of [raw, snake, `${snake}_store`, `${snake}_service`]) {
      if (candidate && vocabulary.has(candidate))
        return {
          term,
          label: humanizeNode(candidate),
          nodes: [candidate],
          nameWords: null,
          via: "taxonomy",
        };
    }
    const suffixed = [...vocabulary]
      .filter((n) => snake.length >= 4 && n.endsWith(`_${snake}`))
      .sort();
    if (suffixed.length > 0 && suffixed.length <= 20)
      return {
        term,
        label: humanizeNode(snake),
        nodes: suffixed,
        nameWords: null,
        via: "taxonomy",
      };
  }
  const words = phrase.split(" ").filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return {
    term,
    label: term.trim(),
    nodes: [],
    nameWords: words.length > 0 ? words : phrase.split(" ").filter(Boolean),
    via: "name",
  };
}

/** "pharmacy_and_drug_store" to "Pharmacy and drug store". */
export function humanizeNode(node: string): string {
  const words = node.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Every curated mapping, for the sync's taxonomy check. */
export function curatedNodes(): string[] {
  return [...new Set(CURATED_CATEGORIES.flatMap((c) => c.nodes))].sort();
}
