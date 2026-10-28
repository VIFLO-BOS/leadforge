/**
 * HAND-BUILT FIXTURES. These are not recorded from the live API: no Google Places API key
 * exists for this project yet. They are shaped after the documented Places API (New) Text
 * Search response format (https://developers.google.com/maps/documentation/places/web-service/text-search,
 * page last updated 2026-10-23): a `places` array of Place objects holding only the
 * field-mask fields, and a top-level `nextPageToken` while more results exist (60 at most).
 *
 * Every value is synthetic: names end in "(Sample)", place IDs start with "fixture-",
 * websites use the reserved .test TLD, and phone numbers come from Ofcom's ranges reserved
 * for TV and radio drama (0113 496 0xxx, 0117 496 0xxx, 0161 496 0xxx), so nothing here can
 * reach a real business or person. Used only by the fixture transport (development and
 * tests, refused in production) and by adapter contract tests.
 */
import type { Place } from "./places.types.js";

interface Area {
  locality: string;
  lga: string;
  region: string;
  regionShort: string;
}

const IKEJA: Area = { locality: "Ikeja", lga: "Ikeja", region: "Lagos", regionShort: "LA" };
const WUSE: Area = {
  locality: "Wuse",
  lga: "Abuja Municipal",
  region: "Federal Capital Territory",
  regionShort: "FC",
};
const YABA: Area = { locality: "Yaba", lga: "Lagos Mainland", region: "Lagos", regionShort: "LA" };

function address(
  n: number,
  street: string,
  area: Area,
): Pick<Place, "formattedAddress" | "addressComponents"> {
  return {
    formattedAddress: `${n} ${street}, ${area.locality}, ${area.region}, Nigeria`,
    addressComponents: [
      { longText: String(n), shortText: String(n), types: ["street_number"], languageCode: "en" },
      { longText: street, shortText: street, types: ["route"], languageCode: "en" },
      {
        longText: area.locality,
        shortText: area.locality,
        types: ["locality", "political"],
        languageCode: "en",
      },
      {
        longText: area.lga,
        shortText: area.lga,
        types: ["administrative_area_level_2", "political"],
        languageCode: "en",
      },
      {
        longText: area.region,
        shortText: area.regionShort,
        types: ["administrative_area_level_1", "political"],
        languageCode: "en",
      },
      { longText: "Nigeria", shortText: "NG", types: ["country", "political"], languageCode: "en" },
    ],
  };
}

function generic(
  category: { key: string; label: string; type: string },
  n: number,
  area: Area,
  phoneBlock: string,
  overrides: Partial<Place> = {},
): Place {
  const pad = String(n).padStart(2, "0");
  const slug = `${category.key}-${pad}`;
  return {
    id: `fixture-${category.key}-${pad}`,
    displayName: { text: `${area.locality} ${category.label} ${pad} (Sample)`, languageCode: "en" },
    ...address(n, "Sample Street", area),
    types: [category.type, "point_of_interest", "establishment"],
    primaryType: category.type,
    primaryTypeDisplayName: { text: category.label, languageCode: "en" },
    businessStatus: "OPERATIONAL",
    nationalPhoneNumber: `0${phoneBlock.slice(0, 3)} ${phoneBlock.slice(3, 6)} ${phoneBlock.slice(6)}${pad}`,
    internationalPhoneNumber: `+44 ${phoneBlock.slice(0, 3)} ${phoneBlock.slice(3, 6)} ${phoneBlock.slice(6)}${pad}`,
    websiteUri: `https://${slug}.example.test/`,
    ...overrides,
  };
}

const RESTAURANT = { key: "restaurant", label: "Restaurant", type: "restaurant" };
const PHARMACY = { key: "pharmacy", label: "Pharmacy", type: "pharmacy" };
const BAKERY = { key: "bakery", label: "Bakery", type: "bakery" };

/** 25 restaurants in Ikeja: two pages. Hand-written edge cases are numbered in the comments. */
function restaurants(): Place[] {
  const list: Place[] = [];
  for (let n = 1; n <= 25; n++) {
    let overrides: Partial<Place> = {};
    if (n === 5) overrides = { businessStatus: "CLOSED_PERMANENTLY" }; // skipped, never billed
    if (n === 7) overrides = { businessStatus: "CLOSED_TEMPORARILY" }; // kept with a warning
    if (n === 9) overrides = { websiteUri: undefined }; // no website
    if (n === 11) overrides = { websiteUri: "https://www.facebook.com/sample-restaurant-11" }; // a social profile, not a website
    if (n === 12)
      overrides = {
        attributions: [
          {
            provider: "Sample Listings Provider (fixture)",
            providerUri: "https://provider.example.test",
          },
        ],
      };
    if (n === 13) overrides = { displayName: undefined }; // no usable name: skipped
    // 14 and 15: two branches of one chain. Same name and website, different place IDs and phones.
    if (n === 14 || n === 15) {
      overrides = {
        displayName: { text: "Chicken Corner Ikeja (Sample)", languageCode: "en" },
        websiteUri: "https://chickencorner.example.test/",
      };
    }
    if (n === 18)
      overrides = { nationalPhoneNumber: undefined, internationalPhoneNumber: undefined }; // no phone
    const place = generic(RESTAURANT, n, IKEJA, "11349607", overrides);
    if (n === 9 || n === 18) {
      // Remove keys explicitly set to undefined so the shape matches what the API returns.
      for (const k of Object.keys(place) as Array<keyof Place>)
        if (place[k] === undefined) delete place[k];
    }
    if (n === 13) delete place.displayName;
    list.push(place);
  }
  return list;
}

function pharmacies(): Place[] {
  return [1, 2, 3].map((n) => generic(PHARMACY, n, WUSE, "11749608"));
}

function bakeries(): Place[] {
  const list: Place[] = [];
  for (let n = 1; n <= 30; n++) list.push(generic(BAKERY, n, YABA, "16149609"));
  return list;
}

/** Results per category key (the text before " in " in the query, lowercased). */
export function placesFixtureData(): Record<string, Place[]> {
  return {
    restaurant: restaurants(),
    restaurants: restaurants(),
    pharmacy: pharmacies(),
    pharmacies: pharmacies(),
    bakery: bakeries(),
    bakeries: bakeries(),
  };
}

/**
 * Text Search pages repeat a place across pages now and then ("identical requests may not
 * return a consistent list of places"). The fixture's second restaurant page repeats place 3.
 */
export const FIXTURE_REPEATED_ON_PAGE_2: Record<string, number> = { restaurant: 3, restaurants: 3 };
