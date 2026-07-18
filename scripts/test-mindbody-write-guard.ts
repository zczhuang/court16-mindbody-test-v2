const guardModuleUrl = new URL("../lib/mindbody-write-guard.ts", import.meta.url).href;
const { evaluateMindbodyWriteGuard } = await import(guardModuleUrl);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const localSandbox = evaluateMindbodyWriteGuard({
  siteId: -99,
  vercelEnv: "development",
});
assert(localSandbox.allowed && localSandbox.target === "sandbox", "local sandbox should pass");

const productionSandbox = evaluateMindbodyWriteGuard({
  siteId: -99,
  vercelEnv: "production",
});
assert(
  !productionSandbox.allowed && productionSandbox.reason === "production_sandbox_forbidden",
  "production must refuse sandbox writes",
);

const disabledRealSite = evaluateMindbodyWriteGuard({
  siteId: 5748154,
  realWritesEnabled: "false",
  allowedSiteIds: "5748154",
});
assert(
  !disabledRealSite.allowed && disabledRealSite.reason === "real_writes_disabled",
  "real sites must be default-off",
);

const unlistedRealSite = evaluateMindbodyWriteGuard({
  siteId: 5748154,
  realWritesEnabled: "true",
  allowedSiteIds: "135479, 985499",
});
assert(
  !unlistedRealSite.allowed && unlistedRealSite.reason === "site_not_allowlisted",
  "a global true must not authorize an unlisted site",
);

const approvedRealSite = evaluateMindbodyWriteGuard({
  siteId: 5748154,
  realWritesEnabled: "true",
  allowedSiteIds: "135479, 5748154",
});
assert(
  approvedRealSite.allowed && approvedRealSite.target === "real_site",
  "both the global gate and exact Site ID should be required",
);

console.log("Mindbody write guard tests passed.");
