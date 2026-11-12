# Webhook Integration

Webhooks allow you to receive real-time HTTP notifications when events occur in your OnlyMonster account. Instead of polling for changes, your server receives a `POST` request with event data as soon as something happens.

> **Note:** Webhook event types are currently in active development. This page will be updated as new events become available.

## Setup

1. Log in to your OnlyMonster dashboard
2. Navigate to **API → Webhooks**
3. Enter your HTTPS endpoint URL and click **Save**
4. Copy and securely store the webhook secret

> **Important:** The webhook secret is displayed **only once**. Save it in a secure location immediately. If you lose it, you will need to create a new webhook.

You can view or delete your active webhook from the same **API → Webhooks** tab.

> **Note:** It can take up to **1 minute** after you save a new webhook before events start being delivered.

## Receiving Webhooks

When an event occurs, OnlyMonster sends an HTTP `POST` request to your configured URL with the following headers:

| Header                   | Description                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `content-type`           | Always `application/json`                                                              |
| `x-om-webhook-signature` | HMAC-SHA256 hex-encoded signature                                                      |
| `x-om-webhook-timestamp` | ISO 8601 timestamp of when the event was sent                                          |
| `x-om-webhook-id`        | UUID unique to this delivery attempt — use it for deduplication if you process retries |

### Payload Format

The request body is a JSON object with the following structure:

```json
{
  "type": "event_type",
  "payload": {
    ...
  }
}
```

* `type` — a string identifying the event (e.g. `chat.message`, `chat.message_sent`)
* `payload` — an object containing event-specific data

### Verifying Signatures

Every webhook request is signed using your secret so you can verify it was sent by OnlyMonster and hasn't been tampered with.

To verify a webhook signature:

1. Get the `x-om-webhook-timestamp` and `x-om-webhook-signature` headers from the request
2. Construct the signed content by concatenating the timestamp, a dot (`.`), and the raw request body:

   ```
   {x-om-webhook-timestamp}.{raw_request_body}
   ```
3. Compute an HMAC-SHA256 hash of the signed content using your webhook secret
4. Compare the hex-encoded result with `x-om-webhook-signature`

#### Node.js / TypeScript

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto'

function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  secret: string,
): boolean {
  const payload = `${timestamp}.${rawBody}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// Usage (Express example)
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-om-webhook-signature'] as string
  const timestamp = req.headers['x-om-webhook-timestamp'] as string
  const rawBody = req.body.toString()

  if (!verifyWebhookSignature(rawBody, signature, timestamp, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature')
  }

  const event = JSON.parse(rawBody)
  // Process event...

  res.status(200).send('OK')
})
```

#### Go

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
)

func verifyWebhookSignature(rawBody, signature, timestamp, secret string) bool {
	payload := fmt.Sprintf("%s.%s", timestamp, rawBody)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expected))
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	signature := r.Header.Get("x-om-webhook-signature")
	timestamp := r.Header.Get("x-om-webhook-timestamp")

	if !verifyWebhookSignature(string(body), signature, timestamp, webhookSecret) {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// Process event...

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}
```

## Event Types

All events follow a consistent structure:

```json
{
  "type": "<category>.<action>",
  "payload": {
    // event-specific fields
  }
}
```

The **Source** column in the field tables indicates whether a value originates from **OnlyFans** (so it follows OnlyFans formats and lifecycle — IDs match what you'd see in the OF API) or from **OnlyMonster** (identifiers and metadata generated on our side).

### Fansly

**Available for Fansly today:**

* `chat.message`: OnlyMonster API sends this event when a fan sends a message to a Fansly account.
* `firewall.message_guard.violation.user`: OnlyMonster API sends this event when Message Guard finds a violation in a message that a user writes to a fan of a Fansly account.

### Shared `payload.account` object

Account-scoped events (e.g. `chat.message`, `vault.media_upload.created`, `vault.media_upload.updated`, `firewall.message_guard.violation.user`, `firewall.message_guard.violation.om_api`, `fans.ppv.purchased`, `fans.subscription.new_subscriber`, `fans.tip.received`) include an `account` object on `payload` that identifies which account the event belongs to:

| Field                 | Type   | Source      | Description                                                              |
| --------------------- | ------ | ----------- | ------------------------------------------------------------------------ |
| `account_id`          | string | OnlyMonster | OnlyMonster account ID — stable across platform reconnects.              |
| `platform_account_id` | string | OnlyFans    | OnlyFans user ID of the connected account (your account, not the fan's). |

### `chat.message`

Fires when a chat message is observed on one of your connected OnlyFans accounts. This includes both messages a fan sends to you and messages sent from your account to a fan.

**Example:**

```json
{
  "type": "chat.message",
  "payload": {
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    },
    "message": {
      "message_id": "1234567890",
      "fan_id": "987654321",
      "from_id": "987654321",
      "created_at": "2026-04-27T10:00:00.000Z",
      "text": "Hi!",
      "medias": {
        "55501": { "type": "photo" }
      }
    }
  }
}
```

**Fields (`payload`):**

| Field     | Type     | Source   | Description                                                                                 |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `account` | `object` | mixed    | Identifies the account this event belongs to. See the shared `payload.account` table above. |
| `message` | `object` | OnlyFans | The chat message. See `payload.message` fields below.                                       |

**Fields (`payload.message`):**

| Field        | Type                               | Source   | Description                                                                                                                             |
| ------------ | ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `message_id` | string                             | OnlyFans | OnlyFans message ID.                                                                                                                    |
| `fan_id`     | string                             | OnlyFans | OnlyFans user ID of the fan in the conversation (always the other party — never your own account).                                      |
| `from_id`    | string                             | OnlyFans | OnlyFans user ID of the sender.                                                                                                         |
| `created_at` | string (ISO 8601)                  | OnlyFans | When the message was created on OnlyFans.                                                                                               |
| `text`       | string \| null                     | OnlyFans | Message text. `null` for media-only messages.                                                                                           |
| `medias`     | `Record<string, { type: string }>` | OnlyFans | Map of attached media keyed by OnlyFans media ID. Each value contains the media `type` (e.g. `"photo"`, `"video"`, `"gif"`, `"audio"`). |

**Determining message direction:**

The payload does not include an explicit direction field. Compare `from_id` and `fan_id` to tell incoming from outgoing:

* `from_id === fan_id` → **incoming** — the fan sent the message to you.
* `from_id !== fan_id` → **outgoing** — you sent the message to the fan.

**Restored messages:**

If our connection to OnlyFans is briefly lost, missed activity is reconciled when the connection is restored. For each chat that had new activity during the outage, we deliver **only the most recent message** in that chat — intermediate messages sent during the outage are not backfilled. These deliveries include an additional `metadata` object on the payload:

```json
{
  "type": "chat.message",
  "payload": {
    "account": { "...": "..." },
    "message": { "...": "..." },
    "metadata": {
      "is_restored": true,
      "connection_lost_at": "2026-04-27T09:55:00.000Z"
    }
  }
}
```

| Field                | Type                        | Source      | Description                                                                                        |
| -------------------- | --------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `is_restored`        | boolean (optional)          | OnlyMonster | `true` when the message was backfilled after a brief disconnect rather than received in real time. |
| `connection_lost_at` | string (ISO 8601, optional) | OnlyMonster | When the disconnect started — bounds the period these restored messages cover.                     |

For restored messages, `medias` is delivered as an empty object (`{}`) — media metadata is not available from the backfill source.

### `chat.message_sent`

Fires when a message you submitted via the OnlyMonster API is successfully delivered to OnlyFans. This event is **only** sent for messages you submit through the public API — messages sent by other OnlyMonster features do not trigger this webhook.

**Example:**

```json
{
  "type": "chat.message_sent",
  "payload": {
    "send_id": "snd_01HZX...",
    "account_id": "acc_01HZY...",
    "fan_id": "987654321",
    "platform_message_id": "1234567890"
  }
}
```

**Fields (`payload`):**

| Field                 | Type   | Source      | Description                                                                                                                                                                |
| --------------------- | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_id`             | string | OnlyMonster | Identifier returned to you when you submitted the send request — use it to correlate.                                                                                      |
| `account_id`          | string | OnlyMonster | OnlyMonster account ID the message was sent from.                                                                                                                          |
| `fan_id`              | string | OnlyFans    | OnlyFans user ID of the recipient.                                                                                                                                         |
| `platform_message_id` | string | OnlyFans    | OnlyFans message ID assigned to the delivered message. The corresponding `chat.message` event for this delivery will carry the same value in `payload.message.message_id`. |

### `chat.message_error`

Fires when a message you submitted via the OnlyMonster API fails to be delivered to OnlyFans. As with `chat.message_sent`, this event is only sent for messages submitted through the public API.

**Example:**

```json
{
  "type": "chat.message_error",
  "payload": {
    "send_id": "snd_01HZX...",
    "account_id": "acc_01HZY...",
    "fan_id": "987654321",
    "status": "restricted"
  }
}
```

**Fields (`payload`):**

| Field        | Type                       | Source      | Description                                                                                             |
| ------------ | -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `send_id`    | string                     | OnlyMonster | Identifier returned to you when you submitted the send request — use it to correlate.                   |
| `account_id` | string                     | OnlyMonster | OnlyMonster account ID the message was attempted from.                                                  |
| `fan_id`     | string                     | OnlyFans    | OnlyFans user ID of the intended recipient.                                                             |
| `status`     | `"restricted" \| "failed"` | OnlyMonster | `restricted` — the recipient has blocked or restricted messages. `failed` — any other delivery failure. |

### `vault.media_upload.created`

Fires when a new media upload is created in your OnlyMonster vault. The upload starts in the `uploaded` state and transitions through processing/exporting states; subsequent transitions are delivered as `vault.media_upload.updated` events.

**Example:**

```json
{
  "type": "vault.media_upload.created",
  "payload": {
    "media_upload_id": "a3f8c9b1-7e2d-4f8a-9b6c-1d2e3f4a5b6c",
    "media_id": null,
    "status": "uploaded",
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    },
    "created_at": "2026-04-27T10:00:00.000Z",
    "updated_at": "2026-04-27T10:00:00.000Z"
  }
}
```

**Fields (`payload`):**

| Field             | Type              | Source      | Description                                                                                                             |
| ----------------- | ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `media_upload_id` | string            | OnlyMonster | Stable OnlyMonster identifier for this upload — use it to correlate `created` and subsequent `updated` events.          |
| `media_id`        | string \| null    | OnlyFans    | OnlyFans media ID assigned once the upload has been exported to the platform. `null` until export completes.            |
| `status`          | string (enum)     | OnlyMonster | Current upload state. One of `uploaded`, `processing`, `processed`, `exporting`, `exported`, `failed`, `unprocessable`. |
| `account`         | `object`          | mixed       | Identifies the account this upload belongs to. See the shared `payload.account` table above.                            |
| `created_at`      | string (ISO 8601) | OnlyMonster | When the upload row was created.                                                                                        |
| `updated_at`      | string (ISO 8601) | OnlyMonster | When the upload row was last persisted. Equal to `created_at` for a freshly created upload.                             |

**Note:** Ordering and dedup guidance is shared with `vault.media_upload.updated` below — read it before storing state.

### `vault.media_upload.updated`

Fires on any persisted change to an existing vault media upload — most commonly a status transition (e.g. `processing → processed`) or an assignment of `media_id` once the upload is processed.

**Important:**

* Consumers should not assume a specific delta from a single event — read `status` (and `media_id`) on every event and reconcile against `media_upload_id`.
* Events for the same `media_upload_id` may arrive **out of order**. Order them by `updated_at` before applying — do not flip a stored status backward just because a newer event was received first.
* Vault events may be delivered more than once (e.g. when a previous attempt's response was lost in flight) — treat `(media_upload_id, updated_at)` as the dedup key. `x-om-webhook-id` changes on every retry attempt and is **not** suitable for cross-retry deduplication.

**Example:**

```json
{
  "type": "vault.media_upload.updated",
  "payload": {
    "media_upload_id": "a3f8c9b1-7e2d-4f8a-9b6c-1d2e3f4a5b6c",
    "media_id": "55501",
    "status": "processed",
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    },
    "created_at": "2026-04-27T10:00:00.000Z",
    "updated_at": "2026-04-27T10:00:30.000Z"
  }
}
```

**Fields (`payload`):** Same as `vault.media_upload.created` above. `updated_at` advances on each transition.

### `firewall.message_guard.violation.user` / `firewall.message_guard.violation.om_api`

Fires when Message Guard — OnlyMonster's content moderation feature — blocks an outgoing message because it contains restricted content. The payload identifies the account, the chat where the violation occurred, the message text, and the specific words and topics that were detected.

The event is split by **who** triggered the blocked message, so you can subscribe to one or both:

* **`firewall.message_guard.violation.user`** — a human operator sent the message.
* **`firewall.message_guard.violation.om_api`** — the message was sent via the OnlyMonster API.

Both event types carry the same `payload` shape; only the `type` and which principal-id field is populated differ (see `user_id` / `om_api_token_id` below).

**Example:**

```json
{
  "type": "firewall.message_guard.violation.user",
  "payload": {
    "violation_id": "01J5Q8X7VZ2K3N4M5P6Q7R8S9T",
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    },
    "user_id": "67890",
    "om_api_token_id": null,
    "context": "message",
    "chat_link": "https://onlyfans.com/my/chats/chat/987654321",
    "message": "send a tip to my venmo or pay in bitcoin",
    "violation": {
      "restricted_words": ["venmo", "bitcoin"],
      "topics": ["finance", "double_meaning"]
    },
    "created_at": "2026-05-25T10:00:00.000Z"
  }
}
```

**Fields (`payload`):**

| Field             | Type              | Source      | Description                                                                                                                        |
| ----------------- | ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `violation_id`    | string            | OnlyMonster | Stable identifier for this violation — use it as a deduplication key.                                                              |
| `account`         | `object`          | mixed       | Identifies the account this violation belongs to. See the shared `payload.account` table above.                                    |
| `user_id`         | string \| null    | OnlyMonster | OnlyMonster-internal id of the operator who sent the message. Populated for `...violation.user`; `null` for `...violation.om_api`. |
| `om_api_token_id` | string \| null    | OnlyMonster | Id of the OnlyMonster API token that sent the message. Populated for `...violation.om_api`; `null` for `...violation.user`.        |
| `context`         | string (enum)     | OnlyMonster | What kind of content triggered the check. One of `message`, `mass_message`, `post`, `comment`, `auto_message`.                     |
| `chat_link`       | string \| null    | OnlyFans    | URL to the OnlyFans chat where the violation occurred. `null` for violations outside a chat context.                               |
| `message`         | string            | OnlyMonster | The full text of the operator's message that triggered the violation.                                                              |
| `violation`       | `object`          | OnlyMonster | Details of what was detected. See `payload.violation` fields below.                                                                |
| `created_at`      | string (ISO 8601) | OnlyMonster | When the violation was recorded.                                                                                                   |

**Fields (`payload.violation`):**

| Field              | Type      | Source      | Description                                                                                                                                                        |
| ------------------ | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restricted_words` | string\[] | OnlyMonster | Specific words or phrases from your organisation's restricted-words list that matched the message text.                                                            |
| `topics`           | string\[] | OnlyMonster | Higher-level topical categories the message was classified into (e.g. `finance`, `double_meaning`). Includes both word-list topic tags and AI-inferred categories. |

**Deduplication:** `violation_id` is stable across retries. Use it as your dedup key — `x-om-webhook-id` changes on every retry attempt and is **not** suitable for cross-retry deduplication.

### `fans.subscription.new_subscriber`

Fires the **first time** a fan subscribes to one of your connected OnlyFans accounts.

Only a fan's first-ever subscription to a given account fires this event. The following do **not** fire it:

* **Renewals** — an active subscription continuing into the next billing period.
* **Re-subscriptions** — a fan who subscribed to this account before, let it lapse, and subscribed again.

You therefore receive it at most once per `(account_id, fan_id)` pair — see **Deduplication** below for the at-least-once delivery caveat.

**Example:**

```json
{
  "type": "fans.subscription.new_subscriber",
  "payload": {
    "fan_id": "987654321",
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    }
  }
}
```

**Fields (`payload`):**

| Field     | Type     | Source   | Description                                                                                        |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------------- |
| `fan_id`  | string   | OnlyFans | OnlyFans user ID of the fan who started the subscription.                                          |
| `account` | `object` | mixed    | Identifies the account this subscription belongs to. See the shared `payload.account` table above. |

**Deduplication:** the event targets each `(account_id, fan_id)` pair once, but — like every webhook — it is delivered **at least once**, so a retry or a rare producer-side overlap can re-deliver the same new subscriber. Use the `(account_id, fan_id)` pair as your dedup key — `x-om-webhook-id` changes on every retry attempt and is **not** suitable for cross-retry deduplication.

### `fans.ppv.purchased`

Fires when a fan purchases pay-per-view content on one of your connected OnlyFans accounts — either a paid direct message (PPV message) or a locked post. The `content_type` field discriminates the two; `content_id` is the OnlyFans message id or post id respectively.

**Example:**

```json
{
  "type": "fans.ppv.purchased",
  "payload": {
    "content_type": "message",
    "content_id": "123456789",
    "fan_id": "987654321",
    "price_gross": 9.99,
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    },
    "purchased_at": "2026-06-15T10:00:00.000Z"
  }
}
```

**Fields (`payload`):**

| Field          | Type              | Source   | Description                                                                                                                                                      |
| -------------- | ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content_type` | string (enum)     | OnlyFans | What was purchased. One of `message` (paid DM) or `post` (locked post).                                                                                          |
| `content_id`   | string            | OnlyFans | OnlyFans id of the purchased content — a message id when `content_type` is `message`, a post id when it is `post`.                                               |
| `fan_id`       | string            | OnlyFans | OnlyFans id of the fan who made the purchase.                                                                                                                    |
| `price_gross`  | number            | OnlyFans | Gross amount the fan paid.                                                                                                                                       |
| `account`      | `object`          | mixed    | Identifies the account this purchase belongs to. See the shared `payload.account` table above.                                                                   |
| `purchased_at` | string (ISO 8601) | OnlyFans | When the purchase occurred. Sourced from the real-time notification and has **minute** precision (seconds are always `:00`); do not rely on sub-minute ordering. |

**Source & timing:** This event is detected in near-real time from the OnlyFans notification stream as soon as the purchase notification arrives — typically within seconds of the purchase. It is suitable for low-latency reactions.

**Deduplication:** Use `(account_id, content_type, content_id, fan_id)` as your dedup key. `x-om-webhook-id` changes on every retry attempt and is **not** suitable for cross-retry deduplication. Note `purchased_at` has only minute precision and must not be relied on for uniqueness.

### `fans.tip.received`

Fires when a fan sends a tip on one of your connected OnlyFans accounts.

**Example:**

```json
{
  "type": "fans.tip.received",
  "payload": {
    "tip_id": "113988808121",
    "fan_id": "987654321",
    "amount_gross": 9.99,
    "account": {
      "account_id": "acc_01HZY...",
      "platform_account_id": "11122233"
    },
    "tipped_at": "2026-06-15T10:00:00.000Z"
  }
}
```

**Fields (`payload`):**

| Field          | Type              | Source   | Description                                                                                                                                                 |
| -------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tip_id`       | string            | OnlyFans | Stable identifier for this tip (the OnlyFans notification id). **Use this as your deduplication key** — it is stable across delivery retries.               |
| `fan_id`       | string            | OnlyFans | OnlyFans id of the fan who sent the tip.                                                                                                                    |
| `amount_gross` | number            | OnlyFans | Gross amount the fan tipped.                                                                                                                                |
| `account`      | `object`          | mixed    | Identifies the account this tip belongs to. See the shared `payload.account` table above.                                                                   |
| `tipped_at`    | string (ISO 8601) | OnlyFans | When the tip was sent. Sourced from the real-time notification and has **minute** precision (seconds are always `:00`); do not rely on sub-minute ordering. |

**Source & timing:** Detected in near-real time from the OnlyFans notification stream as soon as the tip notification arrives — typically within seconds of the tip. Suitable for low-latency reactions.

**Deduplication:** Use `tip_id` as your dedup key — it is the OnlyFans notification id for the tip and is stable across delivery retries, so it correctly collapses retried deliveries of the same tip. Do **not** use `x-om-webhook-id` — it changes on every retry attempt.

## Retry & Delivery Behavior

| Behavior            | Details                                |
| ------------------- | -------------------------------------- |
| **Timeout**         | 15 seconds per request                 |
| **Retries**         | Up to 3 attempts with 15-second delay  |
| **Retry condition** | 5xx server errors and network failures |
| **No retry**        | 2xx (success), 3xx, 4xx responses      |
| **Redirects**       | Not followed                           |

Your endpoint must respond with an HTTP `2xx` status code to acknowledge receipt. Any `5xx` response or network failure will trigger a retry.

### Backpressure during sustained timeouts

To protect both your endpoint and our delivery pipeline, we apply per-webhook backpressure when an endpoint stops responding entirely. If a webhook's endpoint times out (no response within the 15-second window) on several consecutive deliveries, we **temporarily pause delivery to that webhook for \~1 minute**. Events that fire during the pause window are **dropped — not retried**. After the pause, we send a single probe; if it succeeds, normal delivery resumes immediately, otherwise the pause renews. Backpressure is isolated per webhook target, so a slow endpoint on one webhook does not pause delivery to your other webhooks.

Backpressure is triggered only by request timeouts. 5xx responses, network errors (e.g. connection refused, DNS), and SSRF/HTTP-blocked targets do **not** trigger it — they follow the standard retry table above.

If you need a complete history of events, treat webhooks as a real-time signal and reconcile against the corresponding polling endpoints periodically. Backpressure pauses are observable on your side as a gap with no delivery attempts.

## Best Practices

* **Verify signatures** — Always verify the `x-om-webhook-signature` before processing any event to ensure authenticity.
* **Respond quickly** — Return a `200` response immediately, then process the event asynchronously. Long-running processing may cause timeouts.
* **Use HTTPS** — Webhook URLs must use HTTPS. HTTP endpoints are rejected.
* **Secure your secret** — The webhook secret is shown only once during setup. Store it in a secrets manager or environment variable.