/**
 * Static knowledge base for the Class Concierge chatbot.
 *
 * This is the "R" in the simple stuff-the-context RAG: ~2 KB, inlined
 * directly into the Gemini system prompt. Single source of truth so the
 * widget's deterministic data and the LLM's answers can't drift.
 */

export const CHATBOT_KB = `
COURT 16 — ADULT TENNIS CLASSES KNOWLEDGE BASE
(All prices are USD. "Member" rates require an adult membership at that location.
 Group classes cap at 6 players, 60 min. Pickleball clinics are 45 min.)

LOCATIONS & PRICING

1. Downtown Brooklyn (NY)
   - Adult Tennis Membership (single): $695/yr
   - Group class: drop-in $69 · 10-pack $640 · 20-pack $1,180
     Member: drop-in $65 · 10-pack $604 · 20-pack $954
   - Private 60 min: $157 non-member / $127 member
   - Semi-private 60 min (per person): $100 / $80

2. Long Island City, Queens (NY)
   - Adult Tennis Membership (single): $525/yr
   - Group class: drop-in $69 · 10-pack $640 · 20-pack $1,180
     Member: drop-in $65 · 10-pack $618 · 20-pack $1,022
   - Private 60 min: $170 / $151
   - Semi-private 60 min: $100 / $80

3. FiDi, Manhattan (NY)
   - Adult Tennis Membership (single): $695/yr
   - Group class: drop-in $69 · 10-pack $640 · 20-pack $1,180
     Member: drop-in $65 · 10-pack $604 · 20-pack $954
   - Private 60 min: $157 / $127
   - Semi-private 60 min: $100 / $80

4. Ridge Hill, Yonkers (NY)  — ONLINE BOOKING ENABLED (Tennis Intro $75)
   - Adult Tennis Membership (single): $550/yr
   - Group class: drop-in $55 · 10-pack $465 · 20-pack $880
     Member: drop-in $49 · 10-pack $434 · 20-pack $792
   - Private 60 min: $133 / $103
   - Semi-private 60 min: $93 / $73

5. Fishtown, Philadelphia (PA)
   - Adult Tennis Membership (single): $425/yr
   - Group class: drop-in $45 · 10-pack $400 · 20-pack $700
     Member: drop-in $39 · 10-pack $360 · 20-pack $640
   - Private 60 min: $107 / $87
   - Semi-private 60 min: $81 / $61

6. Newton, Massachusetts — NEWEST LOCATION
   - Pricing is NOT on the public pricing sheet. Do NOT invent rates.
   - If asked, say "Newton is our newest spot and pricing isn't public yet —
     I can have the Newton team reach out."

CLASS LEVELS (same five tiers at every location)

- Introduction to Tennis     — new to tennis (no rating)
- Beginner                   — USTA 1.0 – 2.5
- Advanced Beginner          — USTA 2.0 – 2.5 (topspin, slice serves)
- Intermediate               — USTA 2.5 – 3.5 (real point play)
- Advanced                   — USTA 3.5+ (tournament prep)

FORMATS
- Group (max 6 players)
- Semi-private (you + 1, same level recommended)
- Private (1-on-1)

INTRO OFFER (Yonkers / Ridge Hill only, today)
- Tennis Intro Special: $75 for your first 60-min adult class with a coach.
- Available to NEW Court 16 players at any level (the coach matches the drill
  intensity to where you actually are).
- Booked in this chat: pick a date/time → leave name, email, phone, DOB →
  Court 16 holds the spot pending payment. Cart link returned at the end.
- For the other locations (Brooklyn, LIC, FiDi, Philly, Newton) online intro
  booking is NOT yet enabled. Direct the user to court16.com/locations or
  offer to have staff reach out.

MEMBERSHIP
- Not required to play. Membership unlocks ~10–15% off classes,
  pro-shop discounts, and partner-rate pairing.

POLICIES
- Group cancellation: 24-hour advance notice.
- Late arrival: more than 5 min late = wait for next ball pickup.
- Account/profile created automatically via MindBody on first booking.

USEFUL LINKS
- Group bookings:    https://www.court16.com/locations
- Private/semi:      https://www.court16.com/book-private
- Membership:        https://www.court16.com/adult-membership
- Pro shop:          https://shop.court16.com
- iOS app:           https://apps.apple.com/us/app/court-16-tennis-remixed/id1638170423
- Android app:       https://play.google.com/store/apps/details?id=com.fitnessmobileapps.court16tennisremixed

WHAT THE CHATBOT CAN ACTUALLY DO RIGHT NOW
- Qualify the player (experience, years, goal).
- Match level + location + format → quote real prices from above.
- For Ridge Hill: list LIVE upcoming class slots from MindBody and book
  the $75 intro fully in-chat.
- For other locations: deep-link to court16.com booking pages.
- Hand off to staff via email capture if booking isn't possible online.

GUARDRAILS (you, the LLM, must follow)
- Never invent prices, times, coach names, or class names not present in
  the knowledge base or the LIVE SLOTS section.
- For Newton pricing: refuse to guess. Offer staff handoff.
- Do not promise refunds, comped sessions, or terms beyond what's listed.
- If a question is unrelated to Court 16 / tennis / booking, say so briefly
  and steer the user back to the matching flow.
- Keep replies short and texty — 1–3 sentences, no bullet lists unless
  the user explicitly asks for a comparison.
`.trim();
