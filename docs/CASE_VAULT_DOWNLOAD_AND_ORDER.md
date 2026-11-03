# Case Vault — download for everyone, date-then-court order

Two changes the chambers asked for. Both are server-side, in the web app
(`legaleasy`). The mobile app's part is already done. The snippets below
were written without the web source to hand, so names are illustrative.
Before editing, follow `legaleasy/AGENTS.md`.

## 1. Let every member of an office download the Case Vault

**Today:** `POST /api/app/cases/export` is office-admin only. Anyone else
gets a 403.

**Wanted:** any signed-in member of the office can export the **active
Case Vault**: the current filter, or the whole vault. That covers every
role in the office (advocate, junior, clerk, viewer) as well as the admin.

- Drop the admin-role check for `filters.scope` absent or `"active"`.
  Keep `requirePartner` exactly as it is, so a member still only ever
  exports their own office's cases.
- `selectedIds` stays as safe as it is today. Every id is matched within
  the caller's office, so another office's id returns nothing.
- **Disposed archive** (`scope: "disposed"`) and the **Hearing Track**
  export are not part of this request. Leave them admin-only.

This reverses an earlier decision that the full case register stays with
the admin. The chambers made that call knowingly: the file includes
clients' phone numbers, and every member will now be able to take it out
of the app.

The app now shows Download to everyone. Until this ships, a non-admin who
taps it sees "Downloading is still limited to the office admin."

## 2. "Next hearing" order: date first, then court in Court Hub order

**Today:** `sort=hearing` orders by next hearing date only. Matters on the
same day come out in no useful order.

**Wanted:** the order a cause list is read in.

1. **Next hearing date**, soonest first, compared by **calendar day in
   IST**, not timestamp. Undated matters keep their current place, leading.
2. **Within a day, by court in Court Hub order.** That's the court's
   number (the first number in its `number` field: "Hall 3" → 3, "2" → 2),
   ascending. Courts with no number come after numbered ones, and the court
   name breaks ties. This is exactly the comparator Court Hub already uses
   (`firstNumber()` in `src/app/app/courts/CourtHubClient.tsx`; the mobile
   copy is `lib/court-order.ts`). A case whose court isn't in Court Hub
   (no `courtId`) counts as un-numbered and sorts by its court name.
3. **Then case number**, so the order is stable from page to page.

Apply it in **one place** (`lib/case-sort`) and use it from both:

- `GET /api/app/cases` — the Case Vault list, which is paginated, so the
  sort must happen in the database query, before `skip`/`limit`.
- `POST /api/app/cases/export`: the app sends the list's `sort` inside
  `filters`. Check the export honours it. If it orders rows its own way
  today, switch it to `lib/case-sort` so the file matches the screen.

**Suggested approach.** Mongo can't sort on a number parsed out of a
string, so store one:

- Add `numberKey: number | null` to the Court model, set on create and
  update with the same `firstNumber()`. Run a one-off backfill for
  existing courts.
- In the cases query, `$lookup` the court by `courtId`, then sort on
  `{ hearingDay: 1, courtHasNumber: -1, courtNumberKey: 1, courtName: 1, caseNo: 1 }`,
  where `hearingDay` is `$dateTrunc` of `nextHearingDate` to the day in
  `Asia/Kolkata`. Keep undated matters where `sort=hearing` puts them now.

The app also switches the order to "Next hearing" by itself when someone
picks a hearing-date range in the filter. So "cases between 1 and 15
Nov", on screen and in the downloaded file, reads date by date, court by
court.

## Check

1. Sign in as a non-admin member and download the Case Vault as PDF,
   Word and Excel: it works, and contains only their office's cases.
2. As that member, a disposed-archive export is still refused.
3. Give three cases the same next hearing date in courts numbered 3, 1
   and an un-numbered one. Filter to that date: they list as court 1,
   court 3, then the un-numbered court, and the downloaded file has the
   same order.
4. Across a page boundary (more than 50 matching cases), no case is
   repeated or skipped.
