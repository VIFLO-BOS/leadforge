import { Injectable } from "@nestjs/common";
import { DATA_LICENSES, DataLicenseId, type DataLicensesResponse } from "@leadforge/contracts";
import { FOURSQUARE_NOTICE_TEXT, FOURSQUARE_NOTICE_URL, LICENSE_TEXTS } from "./license-texts.js";
import { OvertureCatalogService } from "./overture-catalog.service.js";
import {
  DATA_DISCLAIMER,
  OVERTURE_LICENSING,
  OVERTURE_MODIFICATIONS,
} from "./overture-licensing.js";

const APPLIES_TO: Record<DataLicenseId, string> = {
  "CDLA-Permissive-2.0":
    "Overture Maps Places records from Meta, Microsoft, Uberall, PinMeTo, DAC, OpenTravel Alliance and other CDLA datasets, and Overture's confidence scores (99.3% of Nigerian places).",
  "Apache-2.0":
    "Overture Maps Places records from Foursquare (0.1% of Nigerian places), with the Foursquare NOTICE below.",
  "CC0-1.0":
    "Overture Maps Places records from AllThePlaces (public domain dedication; credited for consistency).",
  "ODbL-1.0":
    "Overture Maps division boundaries (© OpenStreetMap contributors) used to assign states and local government areas. LeadForge stores the assigned names, not the boundaries.",
  "CC-BY-4.0":
    "Overture Maps division boundaries from geoBoundaries and Esri Community Maps contributors used to assign states and local government areas.",
};

/**
 * The Data sources and licences page (`GET /public/data-licenses`): licence texts, attribution
 * lines, the Foursquare NOTICE, LeadForge's changes and the disclaimer, as CDLA-Permissive-2.0
 * section 2.1 and Apache-2.0 section 4 require for shared data. Public, no organization data.
 */
@Injectable()
export class DataLicensesService {
  constructor(private readonly catalog: OvertureCatalogService) {}

  async overview(): Promise<DataLicensesResponse> {
    const snapshot = await this.catalog.snapshot().catch(() => null);
    return {
      licenses: DataLicenseId.options.map((id) => ({
        ...DATA_LICENSES[id],
        appliesTo: APPLIES_TO[id],
        textAvailable: Boolean(LICENSE_TEXTS[id]),
      })),
      sources: [
        { source: "overture_places", name: "Overture Maps Places", licensing: OVERTURE_LICENSING },
      ],
      notices: [
        {
          id: "foursquare-notice",
          title: "Foursquare OS Places NOTICE",
          appliesTo:
            "Records whose upstream dataset is Foursquare (Apache-2.0). LeadForge changed these records as described under modifications.",
          url: FOURSQUARE_NOTICE_URL,
          text: FOURSQUARE_NOTICE_TEXT,
        },
      ],
      modifications: OVERTURE_MODIFICATIONS,
      disclaimer: DATA_DISCLAIMER,
      overtureRelease: snapshot?.release ?? null,
    };
  }

  /** Full licence text, or null for an unknown id. */
  text(id: string): string | null {
    const parsed = DataLicenseId.safeParse(id);
    return parsed.success ? LICENSE_TEXTS[parsed.data] : null;
  }

  noticeText(): string {
    return FOURSQUARE_NOTICE_TEXT;
  }
}
