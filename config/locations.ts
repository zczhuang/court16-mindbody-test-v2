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

export const LOCATIONS: Location[] = [
  {
    id: "brooklyn",
    name: "Downtown Brooklyn",
    fullName: "NY - Downtown Brooklyn",
    siteId: 5748147,
    address: "526 Atlantic Ave",
    city: "Brooklyn",
    state: "NY",
  },
  {
    id: "lic",
    name: "Long Island City, Queens",
    fullName: "NY - Long Island City, Queens",
    siteId: 5748148,
    address: "4-33 Vernon Blvd",
    city: "Long Island City",
    state: "NY",
  },
  {
    id: "fidi",
    name: "FiDi, Manhattan",
    fullName: "NY - FiDi, Manhattan",
    siteId: 5748149,
    address: "30 Broad St",
    city: "New York",
    state: "NY",
  },
  {
    id: "ridgehill",
    name: "Ridge Hill, Yonkers",
    fullName: "NY - Ridge Hill, Yonkers",
    siteId: 5748154,
    address: "32 Market Street",
    city: "Yonkers",
    state: "NY",
  },
  {
    id: "fishtown",
    name: "Fishtown, Philadelphia",
    fullName: "PA - Fishtown, Philadelphia",
    siteId: 5751421,
    address: "1241 N Front St",
    city: "Philadelphia",
    state: "PA",
  },
  {
    id: "newton",
    name: "Newton",
    fullName: "MA - Newton",
    siteId: 5751422,
    address: "300 Needham St",
    city: "Newton",
    state: "MA",
  },
];

export function getLocationById(id: string): Location | undefined {
  return LOCATIONS.find((l) => l.id === id);
}
