# Sign out of all devices — server change

The mobile app now has **More → Account → Sign out of all devices**. It calls
one new endpoint on the web app. Until that endpoint is deployed, the option
shows "Not available yet" and signs nobody out.

This is the change needed in the web app (`legaleasy`, Next.js 16). The
snippets below were written without the web source to hand, so names like
`User`, `PushToken`, `verifyMobileToken` stand in for whatever the code
actually calls them. Before editing, follow `legaleasy/AGENTS.md` (read the
bundled Next 16 docs first; `proxy.ts`, not `middleware.ts`).

## Why a server change is needed

Mobile sign-in issues a long-lived JWT, and nothing on the server records it.
Signing out on the phone only deletes the phone's copy. A token on a lost or
shared phone stays valid until it expires, and the server has no way to
cancel it. The fix is a **session version** on each user: every token
carries the version it was issued under, and bumping the version kills every
token issued before.

## 1. User model

Add a counter to the user document:

```ts
sessionVersion: { type: Number, default: 0 }
```

No migration needed: a missing value reads as `0`.

## 2. Put the version in every token

**Mobile** — `POST /api/mobile/login` is the only route that mints mobile
tokens. Add the claim when signing:

```ts
const token = signMobileToken({ /* existing claims */, sv: user.sessionVersion ?? 0 });
```

**Web** — so "all devices" covers browsers too, stamp the NextAuth token at
sign-in, in the `jwt` callback:

```ts
async jwt({ token, user }) {
  if (user) token.sv = user.sessionVersion ?? 0;
  return token;
}
```

## 3. Reject stale tokens

In the shared check that `requirePartner()` and the global-admin guard both
use — wherever the user document is loaded for a Bearer token or a web
session — add:

```ts
if ((claims.sv ?? 0) !== (user.sessionVersion ?? 0)) {
  return unauthorized(); // 401, same as an invalid token
}
```

It has to cover every authenticated route: `/api/mobile/me`, `/api/app/*`,
`/api/admin/*`, and the web pages. A **401** is what makes the app sign
itself out: any 401 on an authenticated request clears the token and
returns to the landing screen.

Tokens issued before this ships have no `sv`, so they read as `0` and keep
working. Nobody is forced to sign in again on deploy. They stop working the
first time their user signs out of all devices.

## 4. The endpoint

`src/app/api/mobile/logout-all/route.ts`:

```ts
export async function POST(req: Request) {
  const auth = await requireAnyUser(req); // same Bearer guard; any user type
  if (!auth.ok) return auth.response;     // 401

  await User.updateOne({ _id: auth.user.id }, { $inc: { sessionVersion: 1 } });

  // Required, not optional: a phone that's been signed out must stop
  // showing this account's notifications. The app doesn't revoke its own
  // push token in this flow, because its token is dead by the time it could.
  await PushToken.deleteMany({ userId: auth.user.id });

  return Response.json({ ok: true });
}
```

Optionally, write an entry to the office activity log ("Signed out of all
devices").

### What the app expects

| Response | App does |
| --- | --- |
| `200 { ok: true }` | Clears its token and badge, returns to the landing screen |
| `401` | Treats the session as already dead and signs out |
| `404` | Shows "Not available yet"; stays signed in |
| anything else | Shows the `error` field from the JSON body; stays signed in |

## Recommended, same mechanism

Bump `sessionVersion` (and clear push tokens) on **password reset** and
**password change** too. Someone who changes their password because it
leaked expects the leaked sessions to end.

## Test checklist

1. Sign in on phone A, phone B and the web with the same account.
2. On phone A: More → Sign out of all devices → Sign out everywhere.
   Phone A lands on the landing screen.
3. Phone B: the next screen load or pull-to-refresh signs it out.
4. Web: the next navigation sends it to sign-in.
5. Trigger a notification for that account: neither phone receives it.
6. Sign in again on phone B: works, and notifications resume.
7. A different user in the same office is unaffected throughout.
