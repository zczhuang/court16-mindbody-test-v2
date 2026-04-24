/**
 * Court 16 location configuration.
 * locationId values match the enrollment tool's existing API parameter format.
 * siteId values are MindBody Site IDs from the diagnostic audit.
 */
export interface Location {
  id: string; // URL-safe slug used in API calls
  name: string; // Display name
  fullName: string; // Full display with state prefix
  siteId: number; // MindBody Site ID
  address: string;
  city: string;
  state: string;
  /**
   * Per-location Sign in destination. Falls back to the generic
   * court16.com/login when undefined. Replace with per-location URLs
   * once Squarespace has them (e.g. /login/brooklyn or a MindBody
   * classic URL with studioid={siteId}).
   */
  loginUrl?: string;
}

/** Default login URL used when a location's `loginUrl` is undefined. */
export const DEFAULT_LOGIN_URL = "https://www.court16.com/login";

export function getLoginUrlFor(loc: Location): string {
  return loc.loginUrl ?? DEFAULT_LOGIN_URL;
}

/**
 * Per-location login URLs — the EXACT links court16.com/login uses.
 * Different clubs use different MindBody paths (/ASP/su1.asp vs
 * /consumermyinfo vs /classic/ws) — preserved here verbatim so Sign in
 * behaves identically to Court 16's existing login page.
 * Source: Stuart pulled these from court16.com/login on 2026-04-18.
 */
const LOGIN_URLS: Record<string, string> = {
  brooklyn:
    "https://clients.mindbodyonline.com/ASP/su1.asp?catid=&classid=0&date=2%2F3%2F2022&justloggedin=&loc=1&lvl=&nLgIn=&optForwardingLink=&pMode=0&page=&prodGroupId=&prodid=&qParam=&sSU=&studioid=135479&stype=&tg=&trn=0&view=&vt=",
  lic:
    "https://clients.mindbodyonline.com/ASP/su1.asp?catid=&classid=0&date=2%2F2%2F2022&justloggedin=&loc=1&lvl=&nLgIn=&optForwardingLink=&pMode=0&page=&prodGroupId=&prodid=&qParam=&sSU=&studioid=985499&stype=&tg=&trn=0&view=&vt=",
  fidi:
    "https://clients.mindbodyonline.com/ASP/su1.asp?catid=&classid=0&date=8%2F18%2F2022&justloggedin=&loc=1&lvl=&nLgIn=&optForwardingLink=&pMode=0&page=&prodGroupId=&prodid=&qParam=&sSU=&studioid=5728093&stype=&tg=&trn=0&view=&vt=",
  fishtown:
    "https://clients.mindbodyonline.com/consumermyinfo?studioid=5742169&tg=&vt=&lvl=&stype=-2&view=&trn=0&page=&catid=&prodid=&date=3%2f19%2f2025&classid=0&prodGroupId=&sSU=&optForwardingLink=&qParam=info&justloggedin=&nLgIn=&pMode=0&loc=1",
  ridgehill:
    "https://clients.mindbodyonline.com/classic/ws?studioid=5748154&stype=-98",
  newton:
    "https://clients.mindbodyonline.com/classic/ws?studioid=5751422&stype=-98",
};

/**
 * Real Court 16 MindBody site IDs, scraped from court16.com/login
 * on 2026-04-18. Each location card on that page links to
 * clients.mindbodyonline.com/ASP/su1.asp?studioid=<id>; the image
 * filename inside the link (AT-Court16-BK, Court16_LIC, etc.)
 * lets us positively match each studioid to its club.
 *
 * Previous IDs (5748147, 5748148, 5748149, 5751421) turned out to be
 * from the Phase 2A prototype's scaffolding, not Court 16's real
 * MindBody sites — replaced with the confirmed ones below.
 */
export const LOCATIONS: Location[] = [
  {
    id: "brooklyn",
    name: "Downtown Brooklyn",
    fullName: "NY - Downtown Brooklyn",
    siteId: 135479,
    address: "526 Atlantic Ave",
    city: "Brooklyn",
    state: "NY",
    loginUrl: LOGIN_URLS.brooklyn,
  },
  {
    id: "lic",
    name: "Long Island City, Queens",
    fullName: "NY - Long Island City, Queens",
    siteId: 985499,
    address: "4-33 Vernon Blvd",
    city: "Long Island City",
    state: "NY",
    loginUrl: LOGIN_URLS.lic,
  },
  {
    id: "fidi",
    name: "FiDi, Manhattan",
    fullName: "NY - FiDi, Manhattan",
    siteId: 5728093,
    address: "30 Broad St",
    city: "New York",
    state: "NY",
    loginUrl: LOGIN_URLS.fidi,
  },
  {
    id: "ridgehill",
    name: "Ridge Hill, Yonkers",
    fullName: "NY - Ridge Hill, Yonkers",
    siteId: 5748154,
    address: "32 Market Street",
    city: "Yonkers",
    state: "NY",
    loginUrl: LOGIN_URLS.ridgehill,
  },
  {
    id: "fishtown",
    name: "Fishtown, Philadelphia",
    fullName: "PA - Fishtown, Philadelphia",
    siteId: 5742169,
    address: "1241 N Front St",
    city: "Philadelphia",
    state: "PA",
    loginUrl: LOGIN_URLS.fishtown,
  },
  {
    id: "newton",
    name: "Newton",
    fullName: "MA - Newton",
    siteId: 5751422,
    address: "300 Needham St",
    city: "Newton",
    state: "MA",
    loginUrl: LOGIN_URLS.newton,
  },
];

export function getLocationById(id: string): Location | undefined {
  return LOCATIONS.find((l) => l.id === id);
}
