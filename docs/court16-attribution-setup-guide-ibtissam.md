# Connecting Your Marketing Data — A Claude Code Setup Guide

**For:** Ibtissam — Court 16
**From:** Stuart / Cedarwind
**Date:** June 18, 2026

---

## What this does (in plain English)

Right now, three systems each hold one piece of the picture and don't talk to each other:

- **Google (GTM + Analytics)** knows *where a visitor came from* — which ad, which campaign.
- **HubSpot** knows *who the lead is* once they fill out the trial form.
- **MindBody** knows *who actually paid* — trials, memberships, revenue.

This guide connects them so you can answer: **"which ad / campaign actually produced paying members?"** — and eventually tell Google Ads to spend more on what works.

You'll do it by giving instructions to **Claude Code** (opened in the booking-app project) plus a few clicks in Google Tag Manager and HubSpot. The detailed technical spec already exists at `docs/court16-full-funnel-attribution.md` — most of the prompts below just point Claude Code at it.

> **You don't need to understand the technical doc.** Each step tells you exactly what to paste or click, and how to check it worked.

---

## Step 0 — Get set up in Claude Code (about 2 minutes)

You'll use Claude Code right in your browser — nothing to install.

1. **Accept the GitHub invite.** Open the email from GitHub ("…invited you to court16-mindbody-test"), click **Accept invitation**, and sign in or create a free account using `ibtissam@court16.com`.
2. **Open Claude Code.** Go to **[claude.ai/code](https://claude.ai/code)** and sign in with your Claude account. *(No account yet? Stuart will sort out access.)*
3. **Connect the project.** Click to connect GitHub, allow access, and choose the **court16-mindbody-test** repository.
4. **Confirm it works.** In the message box, type `What is this project?` and send. If it answers, you're ready — go to Step 1.

> Prefer to do it together? It's a 10-minute screenshare — just ask. *(Desktop alternative: Claude Code also has a Mac/Windows app if you'd rather not work in the browser.)*

---

## Before you start (5 minutes)

Have these open / make sure you have access:

- [ ] **Claude Code** open in the `court16-mindbody-test` project (the booking-app code). If you've never opened it, ask Stuart to point you to the folder, then run `claude` in it.
- [ ] **Google Tag Manager** — court16.com container (you have this: container `GTM-KBNVWWQ`).
- [ ] **Google Analytics (GA4)** — admin access. *(This is separate from Tag Manager — if you don't have it, that's the one access to request.)*
- [ ] **HubSpot** — admin (you own the portal, `4832170`).
- [ ] **Google Ads** — access to account `AW-955662958` (only needed for the last, optional step).

**How the steps are marked:**
- 🟦 **Claude Code** — paste the prompt into Claude Code and let it work.
- 🖱️ **Click** — a few clicks in Google Tag Manager, GA4, or HubSpot.

**One rule:** for anything that changes the live website or the booking form, **test first, then publish.** Claude Code will help you test. Don't push code changes straight to the live site — let them go through the normal review/deploy you already use for the trial app.

---

## The order at a glance

1. See what's already connected (Claude Code checks for you)
2. Make sure Google Analytics is switched on
3. Add tracking to the booking page (app.court16.com)
4. Tell HubSpot about the booking subdomain
5. Create the new HubSpot fields that hold the ad info
6. Add the "capture" tag in Tag Manager
7. Connect the booking form to save the ad info
8. Test the whole thing with a fake trial signup

Steps 1–4 are foundation (quick wins). Steps 5–8 are the actual capture. Then there's an optional **"Later"** section for pushing results back to Google Ads.

---

## Step 1 — See what's already connected 🟦

This just shows you the starting point — nothing changes.

**Paste into Claude Code:**

```
Check what analytics and marketing tags are currently live on court16.com
and app.court16.com (use curl, since WebFetch strips script tags). Tell me
which of these are present and which are missing: Google Tag Manager,
Google Analytics 4 (a G-XXXX id), the HubSpot tracking code (portal 4832170),
Google Ads (AW-955662958), and any Meta/Facebook pixel. Then read
docs/court16-full-funnel-attribution.md section 2 and tell me, in plain
language, what the 3 gaps are and which step I should do first.
```

**Check:** Claude Code should report that GTM, HubSpot tracking, and Google Ads are already live — and that Google Analytics (GA4) is the thing to confirm first.

---

## Step 2 — Make sure Google Analytics is switched on 🖱️

We found Tag Manager running, but **no Google Analytics 4** on the page — and an old, dead "Universal Analytics" tag that should go.

1. In **Tag Manager** (court16.com container) → **Tags**. Look for a tag named something like "GA4 Configuration" or "Google Tag" with an ID that starts with **`G-`**.
   - **If it's there:** copy that `G-XXXXXXXX` id — you'll need it in Step 6. Done.
   - **If it's *not* there:** you need to create a GA4 property. Paste into Claude Code: `Walk me through creating a GA4 property for court16.com and adding the Google tag in Tag Manager, step by step, assuming I've never done it.`
2. While you're in Tags, find the old **`UA-158765342-1`** tag (Universal Analytics) and **delete it** — it stopped collecting data in 2023 and only causes confusion.
3. **Don't publish yet** if you only deleted UA — you can batch it with Step 6.

**Check:** You have a `G-XXXXXXXX` id written down, and the old `UA-...` tag is gone.

---

## Step 3 — Add tracking to the booking page 🟦

The booking form lives at **app.court16.com**, which currently has *no* tracking — so the ad info never reaches it. This adds the HubSpot + Google tags there. The booking app is already built to use this data; it's just been starved.

**Paste into Claude Code:**

```
Read docs/court16-full-funnel-attribution.md (Phase 0). The booking app at
app.court16.com has no HubSpot tracking code or GA4 tag, so the hubspotutk
and _ga cookies never reach the trial form. Add the HubSpot tracking code
(portal 4832170) and the GA4 tag to the Next.js booking app so they load on
every page. Put this on a new git branch and show me the change — do NOT
deploy to production. Explain what you changed in one paragraph.
```

**Check:** Claude Code shows you a small code change on a branch. Have Stuart review and deploy it the normal way. (This one's low-risk — it only *adds* tracking, it doesn't touch the booking logic.)

---

## Step 4 — Tell HubSpot about the booking subdomain 🖱️

So HubSpot recognizes a visitor as the *same person* across court16.com and app.court16.com:

1. HubSpot → **Settings** → **Tracking & Analytics** (or **Tracking Code**) → **Domains**.
2. Make sure **`app.court16.com`** is listed alongside `court16.com`. If not, add it.

**Check:** Both `court16.com` and `app.court16.com` appear in HubSpot's tracking domains.

---

## Step 5 — Create the new HubSpot fields 🟦

These are the new contact fields that will store the ad/campaign info (things like `court16_gclid`, `court16_utm_campaign`, `court16_ga_client_id`). They follow the same naming pattern as your existing `court16_` fields.

**Paste into Claude Code:**

```
Read docs/court16-full-funnel-attribution.md section 5 (the field map).
Create those new court16_* attribution properties as HubSpot Contact
properties in portal 4832170, using the same approach the project already
uses to create court16_ properties. Group them sensibly. Before creating
anything, list the exact property names you're about to add and ask me to
confirm. These are new fields only — don't modify any existing property.
```

**Check:** Claude Code lists ~10 new field names, you confirm, and it creates them. You can see them in HubSpot under **Settings → Properties** (search "court16_utm").

---

## Step 6 — Add the "capture" tag in Tag Manager 🖱️ + 🟦

This is the tag that actually grabs the ad info (gclid, utm campaign, etc.) when someone lands on the site and remembers it until they fill out the form.

1. **Get the exact tag code from Claude Code.** Paste:
   ```
   From docs/court16-full-funnel-attribution.md section 7.1, give me the
   Custom HTML capture tag, with the GA4 measurement id filled in as
   G-XXXXXXXX (I'll replace it). Tell me exactly: what tag type to use in
   Tag Manager, what trigger to set, and how to test it in Preview mode.
   ```
2. In **Tag Manager** → **Tags** → **New** → **Custom HTML** → paste the code (replace `G-XXXXXXXX` with your real GA4 id from Step 2).
3. Set the trigger to **All Pages** (or "Initialization – All Pages").
4. Click **Preview** and visit `court16.com/?utm_campaign=test123&gclid=test456`. Check that a cookie named **`c16_attr`** appears (Claude Code's instructions show how).
5. When it looks right, click **Submit / Publish** (this also publishes the Step 2 cleanup).

**Check:** In Preview, after visiting the test URL, a `c16_attr` cookie exists containing `test123` / `test456`.

---

## Step 7 — Connect the booking form to save the ad info 🟦

Now make the trial form actually read that captured info and write it onto the HubSpot contact when someone books.

**Paste into Claude Code:**

```
Read docs/court16-full-funnel-attribution.md sections 5 and 10 (the code-
change map). Wire the booking app to read the c16_attr cookie and the URL
parameters at form submit, and save them into the new court16_* HubSpot
fields — for all three lead paths: the kids trial form, the adult intro
form, and the chatbot lead. Put it on a new git branch, don't deploy, and
give me a short summary I can forward to Stuart for review.
```

**Check:** Claude Code produces a branch with the changes and a plain-language summary. This one touches the booking flow, so **Stuart reviews and deploys it** through the normal trial-app review — don't rush it to production.

---

## Step 8 — Test the whole thing 🟦

Once Steps 3, 6, and 7 are live:

**Paste into Claude Code:**

```
Help me test the attribution end-to-end. I'm going to visit the trial page
with ?utm_source=google&utm_campaign=test_june&gclid=abc123 and submit a
test booking. Tell me exactly what test data to use, then how to find that
test contact in HubSpot and confirm the court16_utm_campaign, court16_gclid,
and court16_ga_client_id fields got filled in.
```

**Check:** Your test contact in HubSpot shows `test_june`, `abc123`, and a GA client id in the new fields. 🎉 That means an ad click is now traveling all the way to the HubSpot contact.

---

## Later (with the Command Center build — not now)

Two final pieces complete the loop, but they belong with the warehouse work, not this guide:

- **Connect to BigQuery** so you can join the Google Analytics behavior, HubSpot leads, and MindBody revenue in one place (this is the Command Center proposal).
- **Push results back to Google Ads** — when MindBody confirms a new member, tell Google Ads (via "Enhanced Conversions for Leads") so it bids on real members, not form-fills. ⚠️ There's a Google deadline of **June 15, 2026** for how these uploads work — Stuart is tracking it.

When you're ready, the prompt is simply: `Read docs/court16-full-funnel-attribution.md Phase 2 and Phase 3 and tell me what's involved.`

---

## If something looks wrong

- **A step's prompt didn't do what you expected?** Tell Claude Code what you saw — e.g. `That didn't work — here's what happened: [paste]. What should I check?`
- **Not sure whether to publish/deploy something?** Ask first: `Is this change safe to publish to the live site, or should Stuart review it? What could go wrong?`
- **Want to undo a Tag Manager change?** Tag Manager keeps every version — use **Versions** → pick the previous one → **Publish**. Ask Claude Code to walk you through it.

**Safe order to remember:** confirm Analytics (Step 2) → add tracking to the booking page (Step 3) → create the fields (Step 5) → capture tag (Step 6) → connect the form (Step 7) → test (Step 8). Foundation before capture, and always test before you publish.
