# Lock screen integrations

**Lock Screen** on the dashboard is laid out like the phone: a live preview, the message shown above
the clock, and up to five cards under it, in order, each with its settings and a notification switch
in place. **Connections** links accounts once, for every card that uses them: connect Habitica there,
then add its Dailies, To-Dos, Habits or Stats cards from Lock Screen → Add card. Each integration produces a *card*: one line, or several pages you step through
with ‹ › arrows, built from a small set of blocks (text, pairs, progress, live times) that Luma
draws in its own style. Cards expire, so a phone that stops getting updates drops them by itself.
Luma shows one at a time, in the order chosen on the dashboard: the arrows step through a card's
pages and on into the next integration, and tapping the card's header skips to the next one. The format, its limits and how
older Luma builds are handled are in [docs/lockscreen-cards.md](lockscreen-cards.md).

| Integration | Line | Updated |
|---|---|---|
| Weather | `12° Cloudy · 15°/8°` for a chosen place, from [Open-Meteo](https://open-meteo.com) (no key) | Every 30 minutes by `integrations:refreshDue` (cron in `convex/crons.ts`); one request per place and unit, cached for 15 minutes across accounts. The place is sent rounded to about a kilometre. |
| Webhook | Whatever is sent to its secret URL | On each request |
| Habitica | Dailies due today, To-Dos, habits, or health/level/gold. Long-press a task to complete it (or `+1` a habit); long-press `✓ Done` to undo. Task reminders become phone notifications | Within seconds of changes in Habitica (its webhook), after every lock screen action, and every 15 minutes |

Webhooks (`convex/http.ts`) accept plain text, or JSON with an optional lifetime (default an hour,
up to a week): one line, several lines to page through, or a full card. `DELETE` clears it:

```sh
curl -d "Bins out tonight" https://luma.example.com/hooks/<token>
curl -H "Content-Type: application/json" \
  -d '{"text": "Parcel arriving", "minutes": 120}' https://luma.example.com/hooks/<token>
curl -H "Content-Type: application/json" \
  -d '{"title": "Windows open", "lines": ["Kitchen", "Bedroom"]}' https://luma.example.com/hooks/<token>
curl -X DELETE https://luma.example.com/hooks/<token>
```

The token is 32 random bytes; anyone who has the URL can change the line, so treat it as a
secret and use **Change address** on the dashboard if it leaks. nginx only forwards `POST` and
`DELETE` with bodies up to 4 KB, and the backend accepts one request every 5 seconds per webhook.

**Habitica** (`convex/kinds/habitica.ts`, card logic in `convex/habiticaCards.ts`) follows Habitica's own
day: dailies come from its `isDue`, and the card expires when the day resets at your day-start
hour. A daily whose reminder went off in the last hour comes first and moves the card to the top;
overdue and due-today To-Dos come first; low health promotes the stats card. Your API Token is
encrypted with `INTEGRATIONS_KEY` (derived from `INSTANCE_SECRET`) and never leaves the server.
**Connections → Habitica** manages your tasks: tabs for dailies, To-Dos and habits, quick add, and an
editor for name, notes, due date and reminder times (`convex/habiticaTasks.ts`). Habitica's website cannot set
reminders, only its phone apps; this writes the same `reminders` field, in your Habitica timezone.
When the dashboard has an `https://` `PUBLIC_URL`, it registers a Habitica webhook pointing at
`/hooks/habitica/<token>` and removes it again with the integration; without one, changes made in
Habitica show up at the next 15-minute refresh.

Accounts that several cards share are *providers* in [`convex/providers/`](../convex/providers)
(credentials, provider webhooks at `/hooks/<provider>/<token>`, dashboard operations), stored by
[`convex/connections.ts`](../convex/connections.ts); a kind that needs one declares `connection` and
receives its settings. Each integration is a *kind* in [`convex/kinds/`](../convex/kinds): an object implementing
`IntegrationKind` ([`types.ts`](../convex/kinds/types.ts)) with its settings validation, secret fields,
label and any of `refresh`, `act` (lock screen long-press), `inbound` (provider webhooks at
`/hooks/<kind>/<token>`), `onAdd` and `onRemove`. The shared machinery in
[`convex/integrations.ts`](../convex/integrations.ts) does the rest for every kind: encrypting secret
settings, scheduling refreshes with backoff, validating and storing cards, the per-integration
notification switch, running actions, routing webhooks, and dashboard `operations` (e.g. Habitica's
task list) through `integrations:operate`. Adding an integration means writing a
kind file and registering it in `kinds/index.ts`; Luma needs no change. Cards can carry phone
notifications (see the spec), which Habitica uses for task reminders. Integrations
that fetch user-supplied URLs are deliberately not included: anyone can create an account, so
they would let strangers make the server request arbitrary addresses, including ones on its own
network.
