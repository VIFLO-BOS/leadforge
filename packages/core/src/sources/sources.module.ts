import { Module } from "@nestjs/common";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { SOURCE_ADAPTERS } from "./source-adapter.js";
import { SourceRateLimiter } from "./source-rate-limiter.js";
import { SourcesService } from "./sources.service.js";
import { SourceConfigRepository } from "./repositories/source-config.repository.js";
import { GooglePlacesAdapter } from "./google-places/google-places.adapter.js";
import { OverturePlacesAdapter } from "./overture-places/overture-places.adapter.js";
import { OvertureModule } from "../overture/overture.module.js";
import {
  FixturePlacesTransport,
  HttpPlacesTransport,
  PLACES_TRANSPORT,
  type PlacesTransport,
} from "./google-places/places-transport.js";

/**
 * Picks how the Google Places adapter reaches Google: the real API when a key is set, the
 * hand-built fixtures in fixture mode (development and tests only; the env schema refuses it
 * in production), or nothing, which makes the source `not_configured`.
 */
export function placesTransportFor(env: ServerEnv): PlacesTransport | null {
  if (env.GOOGLE_PLACES_FIXTURE_MODE && env.NODE_ENV !== "production")
    return new FixturePlacesTransport();
  if (env.GOOGLE_PLACES_API_KEY) return new HttpPlacesTransport(env.GOOGLE_PLACES_API_KEY);
  return null;
}

/**
 * Source registry, adapter contract implementations, per-organization source settings and rate
 * limits. Overture Maps Places is the runnable discovery source; Google Places stays registered
 * but its policy is blocked by Google's terms, so it is never runnable.
 */
@Module({
  imports: [OvertureModule],
  providers: [
    { provide: PLACES_TRANSPORT, inject: [ENV], useFactory: placesTransportFor },
    GooglePlacesAdapter,
    OverturePlacesAdapter,
    {
      provide: SOURCE_ADAPTERS,
      inject: [OverturePlacesAdapter, GooglePlacesAdapter],
      useFactory: (overture: OverturePlacesAdapter, places: GooglePlacesAdapter) => [
        overture,
        places,
      ],
    },
    SourcesService,
    SourceConfigRepository,
    SourceRateLimiter,
  ],
  exports: [
    SourcesService,
    SourceRateLimiter,
    SOURCE_ADAPTERS,
    PLACES_TRANSPORT,
    OverturePlacesAdapter,
    OvertureModule,
  ],
})
export class SourcesModule {}
