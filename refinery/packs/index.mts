import type { PackDefinition } from "../types/pack.mts";

/**
 * Per-pack registry (Brain Factory Decision E).
 *
 * Every pack scaffolded after Phase A/B lives in its own file at
 * `refinery/packs/{id}.mts`. The scaffold CLI (`refinery/scaffold.mts`) writes
 * the new pack file AND appends to this index — atomic on success, manual
 * cleanup on partial failure.
 *
 * The two v1 packs (`franchise-outcomes`, `master`) currently live in
 * `refinery/config/packs.mts` and are merged into the unified `PACKS` record
 * there. New packs go HERE.
 *
 * Discovery is sync (one static import per pack) — no glob, no async startup
 * cost. The scaffold edits this file deterministically.
 */

// SCAFFOLD INSERTS IMPORTS BELOW THIS LINE — do not move or remove this marker
// scaffold:imports
import { franchiseOutcomes } from "./franchise-outcomes.mts";
import { rentalsSwfl } from "./rentals-swfl.mts";
import { permitsSwfl } from "./permits-swfl.mts";
import { hurricaneTracksFl } from "./hurricane-tracks-fl.mts";
import { propertiesLeeValue } from "./properties-lee-value.mts";
import { propertiesCollierValue } from "./properties-collier-value.mts";
import { trafficSwfl } from "./traffic-swfl.mts";
import { creSwfl } from "./cre-swfl.mts";
import { envSwfl } from "./env-swfl.mts";
import { tourismTdt } from "./tourism-tdt.mts";
import { sectorCreditSwfl } from "./sector-credit-swfl.mts";
import { macroUs } from "./macro-us.mts";
import { macroFlorida } from "./macro-florida.mts";
import { macroSwfl } from "./macro-swfl.mts";
import { logisticsSwfl } from "./logistics-swfl.mts";
import { logisticsSwflNowcast } from "./logistics-swfl-nowcast.mts";
import { stormHistorySwfl } from "./storm-history-swfl.mts";
import { master } from "./master.mts";
import { housingSwfl } from "./housing-swfl.mts";
import { fgcuReri } from "./fgcu-reri.mts";
import { safetySwfl } from "./safety-swfl.mts";
import { laborDemandSwfl } from "./labor-demand-swfl.mts";
import { econDevSwfl } from "./econ-dev-swfl.mts";
import { rswAirport } from "./rsw-airport.mts";
import { cityPulseSwfl } from "./city-pulse-swfl.mts";
import { corridorPulseSwfl } from "./corridor-pulse-swfl.mts";
import { newsSwfl } from "./news-swfl.mts";
import { licensesSwfl } from "./licenses-swfl.mts";
import { condoSirsSwfl } from "./condo-sirs-swfl.mts";
import { permitsCommercialSwfl } from "./permits-commercial-swfl.mts";
import { sellerStressSwfl } from "./seller-stress-swfl.mts";
import { marketHeatSwfl } from "./market-heat-swfl.mts";
import { homeValuesSwfl } from "./home-values-swfl.mts";
import { investorZipSwfl } from "./investor-zip-swfl.mts";
import { tierDivergenceSwfl } from "./tier-divergence-swfl.mts";
import { freshnessPulse } from "./freshness-pulse.mts";
import { activeListingsSwfl } from "./active-listings-swfl.mts";
import { priceDistributionSwfl } from "./price-distribution-swfl.mts";
import { listingMomentumSwfl } from "./listing-momentum-swfl.mts";
import { marketTemperatureSwfl } from "./market-temperature-swfl.mts";
import { activeRentalsSwfl } from "./active-rentals-swfl.mts";

// SCAFFOLD INSERTS REGISTRY ENTRIES BELOW THIS LINE — do not move or remove this marker
export const PER_PACK_REGISTRY: Record<string, PackDefinition> = {
  // scaffold:entries
  [franchiseOutcomes.id]: franchiseOutcomes,
  [rentalsSwfl.id]: rentalsSwfl,
  [homeValuesSwfl.id]: homeValuesSwfl,
  [investorZipSwfl.id]: investorZipSwfl,
  [permitsSwfl.id]: permitsSwfl,
  [hurricaneTracksFl.id]: hurricaneTracksFl,
  [propertiesLeeValue.id]: propertiesLeeValue,
  [propertiesCollierValue.id]: propertiesCollierValue,
  [trafficSwfl.id]: trafficSwfl,
  [creSwfl.id]: creSwfl,
  [envSwfl.id]: envSwfl,
  [tourismTdt.id]: tourismTdt,
  [sectorCreditSwfl.id]: sectorCreditSwfl,
  [macroUs.id]: macroUs,
  [macroFlorida.id]: macroFlorida,
  [macroSwfl.id]: macroSwfl,
  [logisticsSwfl.id]: logisticsSwfl,
  [logisticsSwflNowcast.id]: logisticsSwflNowcast,
  [stormHistorySwfl.id]: stormHistorySwfl,
  [master.id]: master,
  [housingSwfl.id]: housingSwfl,
  [fgcuReri.id]: fgcuReri,
  [safetySwfl.id]: safetySwfl,
  [laborDemandSwfl.id]: laborDemandSwfl,
  [econDevSwfl.id]: econDevSwfl,
  [rswAirport.id]: rswAirport,
  [cityPulseSwfl.id]: cityPulseSwfl,
  [corridorPulseSwfl.id]: corridorPulseSwfl,
  [newsSwfl.id]: newsSwfl,
  [licensesSwfl.id]: licensesSwfl,
  [condoSirsSwfl.id]: condoSirsSwfl,
  [permitsCommercialSwfl.id]: permitsCommercialSwfl,
  [sellerStressSwfl.id]: sellerStressSwfl,
  [marketHeatSwfl.id]: marketHeatSwfl,
  [tierDivergenceSwfl.id]: tierDivergenceSwfl,
  [freshnessPulse.id]: freshnessPulse,
  [activeListingsSwfl.id]: activeListingsSwfl,
  [priceDistributionSwfl.id]: priceDistributionSwfl,
  [listingMomentumSwfl.id]: listingMomentumSwfl,
  [marketTemperatureSwfl.id]: marketTemperatureSwfl,
  [activeRentalsSwfl.id]: activeRentalsSwfl,
};
