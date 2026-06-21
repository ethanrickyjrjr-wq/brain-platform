// A conservative "this question is clearly NOT about our market data" gate.
//
// It exists for ONE job: when a user names a SWFL place inside an off-domain question
// ("best Arby's near Cleveland Ave", "what's the weather in Naples"), suppress the eager
// place/data card prelude in the conversation path so the answer doesn't render irrelevant
// housing cards (RULES OF ENGAGEMENT rule 7 — an ordinary answerable is answered plainly,
// not framed as a data gap and not fetched).
//
// It fires ONLY on a strong off-domain signal AND no market-data signal, so it never
// suppresses a genuine data question. A miss (an off-topic ask it doesn't catch) simply
// keeps prior behavior — the grounded model still declines off-topic in prose. The model
// is the real scope judge; this only gates the cards. Keyword heuristic by design.

// Clear non-data domains a SWFL place name can ride on: food/dining, navigation, weather,
// store hours/contact, and everyday errands/entertainment.
const OFF_DOMAIN =
  /\b(restaurants?|arby'?s|mcdonald'?s?|wendy'?s?|burger\s?king|chick[- ]?fil[- ]?a|kfc|taco\s?bell|chipotle|pizza|sushi|bbq|barbecue|coffee|starbucks|dunkin|cafe|café|diner|brunch|breakfast|lunch|dinner|menu|takeout|delivery|grocery|groceries|bar|pub|brewery|nightlife|nightclub|gym|fitness|salon|barber|spa|nail|movie|theater|theatre|cinema|concert|festival|sports?\s?(bar|game|team)|directions?|how\s+do\s+i\s+get\s+to|drive\s+to|driving|parking|gas\s?station|fuel|weather|forecast|temperature|raining|hours|open\s?(now|today|late)|what\s?time|phone\s?number|hospital|urgent\s?care|pharmacy|dentist|doctor|vet\b|veterinar|airport\s+(parking|food|shuttle))\b/i;

// Market-data domains we actually hold. If ANY of these appear, it is (or could be) a
// real question — never gate it as off-topic.
const DATA_DOMAIN =
  /\b(price|prices|pricing|cost|value|values|valuation|worth|rent|rents|rental|lease|market|buy|buying|sell|selling|own|invest|investment|investor|property|properties|real[- ]?estate|housing|home|homes|house|condo|townhome|listing|listings|inventory|days?\s+on\s+market|appreciat|depreciat|equity|mortgage|interest\s?rate|cap\s?rate|noi|vacancy|occupancy|absorption|asking\s?rent|corridor|permit|permits|construction|develop|zoning|flood|fema|insurance|tourism|tourist|hotel|economy|economic|gdp|job|jobs|labor|employment|wage|wages|population|growth|migration|crime|safety|demographic|median|sale|sales|transaction|tax|millage|assessment|forecast.*(market|price|rent))\b/i;

/** True when the question is clearly off our market-data domains (and so should NOT trigger
 *  the place/data card prelude), conservatively. False when in doubt. */
export function isOffTopicQuestion(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  return OFF_DOMAIN.test(t) && !DATA_DOMAIN.test(t);
}
