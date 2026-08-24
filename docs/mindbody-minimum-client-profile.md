# Minimum Mindbody client profile contract

**Live read:** 2026-07-23 21:10–21:13 America/New_York  
**Endpoint:** `GET /public/v6/client/requiredclientfields`  
**Production profile mode:** Consumer (`Api-Key` + `SiteId`, no bearer)  
**Safety:** Read-only; no client records were created or changed.

Mindbody returns a different required-field list when the same endpoint is
called with a source-staff bearer. Court 16's `AddClient` helper deliberately
uses consumer mode, so the consumer-mode result below is the contract that the
public form must satisfy.

| Club | Consumer-mode required client fields |
|---|---|
| Downtown Brooklyn `135479` | AddressLine1, State, City, PostalCode, BirthDate, MobilePhone, EmergContact, IsMale |
| Long Island City `985499` | AddressLine1, State, City, PostalCode, BirthDate, MobilePhone, EmergContact, IsMale |
| FiDi `5728093` | AddressLine1, State, City, PostalCode, BirthDate, MobilePhone, EmergContact, IsMale |
| Ridge Hill `5748154` | AddressLine1, State, City, PostalCode, ReferredBy, BirthDate, MobilePhone, Email, EmergContact, IsMale |
| Fishtown `5742169` | AddressLine1, State, City, PostalCode, BirthDate, MobilePhone, EmergContact, IsMale |
| Newton `5751422` | AddressLine1, State, City, PostalCode, BirthDate, MobilePhone, Email, EmergContact, IsMale |
| Allston `5754600` | AddressLine1, State, City, PostalCode, BirthDate, MobilePhone, Email, EmergContact, IsMale |

`FirstName` and `LastName` are required by `AddClient` itself and therefore do
not appear in the site-configured list. The API reports `IsMale`; this
integration supplies a valid configured `Gender` value. `EmergContact` is a
bundle represented in the AddClient payload by:

- `EmergencyContactInfoName`
- `EmergencyContactInfoPhone`
- `EmergencyContactInfoEmail`
- `EmergencyContactInfoRelationship`

All four subfields were write-verified together at Ridge Hill in May 2026.
The six other sites still require a controlled, staff-approved AddClient
acceptance test before launch; a readback alone does not prove write
acceptance.

## Smallest write-proven truthful parent and child flow

Ask once for:

- Parent: first name, last name, email, mobile phone, birth date, gender.
- Child: first name, last name, birth date, gender.
- Household: street, city, state, ZIP.
- Parent's alternate emergency contact: name, phone, email, relationship.

The parent profile receives the alternate emergency contact. The child profile
uses the registering parent's already-collected name, phone, and email with
relationship `Parent/Guardian`. Household contact/address values are reused
for the child rather than requested twice.

Keep the real parent email at every site even where the site configuration
does not mark it required. Court 16 needs it for duplicate protection, HubSpot
identity, staff contact, shared-family claiming, and a usable Mindbody account.
Ridge Hill's `ReferredBy` can be supplied truthfully as the application-known
constant `Online`; it does not require a parent-facing attribution question.

## Not required by Mindbody AddClient

- Tennis experience
- School
- Marketing lead source / “How did you hear?”
- Free-form notes
- Address line 2

These fields may only remain if Court 16 has a separate, intentional business
use for them. The minimum-profile endpoint now rejects these legacy properties
instead of silently accepting or retaining them. They must never be populated
with invented defaults merely to satisfy another system.
