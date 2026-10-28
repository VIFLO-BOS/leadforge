/**
 * The subset of the Places API (New) `Place` resource LeadForge requests, as documented at
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 * (page last updated 2026-10-23). Only fields named in the field mask are returned.
 */
export interface PlaceLocalizedText {
  text: string;
  languageCode?: string;
}

export interface PlaceAddressComponent {
  longText: string;
  shortText?: string;
  types: string[];
  languageCode?: string;
}

export interface PlaceAttribution {
  provider: string;
  providerUri?: string;
}

export interface Place {
  /** Place ID. Storable indefinitely (Maps Service Specific Terms, General Service Terms 3). */
  id: string;
  displayName?: PlaceLocalizedText;
  formattedAddress?: string;
  addressComponents?: PlaceAddressComponent[];
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: PlaceLocalizedText;
  businessStatus?:
    "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | "BUSINESS_STATUS_UNSPECIFIED";
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  attributions?: PlaceAttribution[];
}

export interface PlacesSearchTextRequest {
  textQuery: string;
  pageSize: number;
  pageToken?: string;
  regionCode?: string;
  languageCode?: string;
  locationBias?: { circle: { center: { latitude: number; longitude: number }; radius: number } };
}

export interface PlacesSearchTextResponse {
  places?: Place[];
  nextPageToken?: string;
}

/** Error body returned by Google APIs. */
export interface GoogleApiErrorBody {
  error?: { code?: number; message?: string; status?: string };
}
