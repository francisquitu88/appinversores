# Market Ledger - Email Notifications System

Complete implementation of email notification system using Resend + Supabase.

## Overview

This system sends users email notifications when new market data appears for tickers they follow:
- News articles
- SEC filings
- Analyst ratings
- Insider trades

## Architecture

```
React/Vite Frontend
    ↓
User preferences (Supabase DB)
    ↓
scrape-watchlist
    ↓
register-notification (Edge Function)
    ↓
notification_sent_log (Supabase DB)
    ↓
send-notification-email (Edge Function)
    ↓
Resend API
    ↓
Email sent to user
```

Key design principles:
- **React never calls Resend directly** - Only Supabase Edge Functions can access API keys
- **Deduplication is automatic** - Each user gets max 1 email per event
- **Fault-tolerant** - Resend failures don't block scraping
- **Best-effort delivery** - Notifications are queued and retried on failure

## Database Schema

### New Tables Created

#### `notification_preferences`
Stores user notification settings.

```sql
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  news_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sec_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ratings_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  insider_trades_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Purpose:** Stores notification preferences per user. Auto-created when user first accesses settings.

#### `notification_sent_log`
Tracks sent notifications to prevent duplicates and enable audit trail.

```sql
CREATE TABLE notification_sent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  ticker TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'news' | 'sec' | 'rating' | 'insider'
  event_id TEXT NOT NULL,   -- Hash/identifier of the event
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', -- 'pending' | 'sending' | 'sent' | 'failed'
  attempts INT NOT NULL DEFAULT 1,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplication constraint
CREATE UNIQUE INDEX notification_sent_log_dedup_idx
  ON notification_sent_log (user_id, ticker, event_type, event_id)
  WHERE status = 'sent';
```

**Purpose:** Prevents duplicate emails and provides audit trail. Key constraint ensures a user gets max 1 email per event.

## Edge Functions

### 1. `send-notification-email`

**File:** `supabase/functions/send-notification-email/index.ts`

**Purpose:** Sends pending email notifications via Resend API.

**Authorization:** Internal service calls only (requires `notificationservice` API key).

**Workflow:**
1. Fetches pending notifications from `notification_sent_log`
2. Generates HTML email using template
3. Calls Resend API with Bearer token from `RESEND_API_KEY`
4. Updates notification status to `sent` or `failed`
5. Records `sent_at` timestamp and any error messages

**Error Handling:**
- If Resend fails, status is `failed` and error is recorded
- Up to 3 retry attempts (configurable)
- Failures don't prevent other notifications from being processed

**Calling this function:**
```bash
curl -X POST https://[YOUR_PROJECT].supabase.co/functions/v1/send-notification-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "apikey: YOUR_NOTIFICATION_SERVICE_KEY" \
  -H "Content-Type: application/json"
```

### 2. `register-notification`

**File:** `supabase/functions/register-notification/index.ts`

**Purpose:** Registers pending notifications when new data is detected.

**Authorization:** Internal service calls only (requires `notificationservice` API key).

**Input:**
```typescript
interface RegisterNotificationRequest {
  ticker: string
  event_type: 'news' | 'sec' | 'rating' | 'insider'
  event_id: string         // Hash of the event for deduplication
  title: string            // Original title from source
  content?: string | null
  url?: string | null
  source?: string
  published_at?: string | null
}
```

**Workflow:**
1. Finds all users following the ticker
2. Checks user preferences (email enabled, event type enabled)
3. Checks if notification was already sent to user (deduplication)
4. Creates `notification_sent_log` entry with status `pending`
5. Returns count of notifications registered

**Calling this function:**
```bash
curl -X POST https://[YOUR_PROJECT].supabase.co/functions/v1/register-notification \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "apikey: YOUR_NOTIFICATION_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "CTMX",
    "event_type": "news",
    "event_id": "abc123def456",
    "title": "CompleteMedical Reports Strong Q3 Results",
    "url": "https://...",
    "published_at": "2026-09-14T10:30:00Z"
  }'
```

## Frontend Component

### `NotificationPreferences`

**File:** `src/components/NotificationPreferences.tsx`

**Purpose:** Provides UI for users to manage notification preferences.

**Features:**
- Toggle email notifications on/off
- Toggle each event type (News, SEC, Ratings, Insider)
- Auto-creates preferences on first visit
- Saves directly to Supabase (no local storage)
- Shows user's email address
- Real-time feedback (success/error messages)

**Usage:**
```typescript
import { NotificationPreferences } from './components/NotificationPreferences'

export function SettingsPage() {
  return <NotificationPreferences />
}
```

**RLS Policies:** Users can only read/update their own preferences.

## Deduplication Logic

Deduplication works in 3 layers:

### Layer 1: Event Identity Hash
Each event type has a unique identifier:
- **News:** `content_hash` from `scraped_items`
- **SEC filings:** `content_hash` from `scraped_items`
- **Analyst ratings:** `content_hash` from `finviz_analyst_ratings`
- **Insider trades:** `content_hash` from `finviz_insider_trades`

Combined with ticker and event type:
```
event_hash = `${ticker}:${event_type}:${original_content_hash}`
```

### Layer 2: Database Constraint
The unique index ensures only ONE notification per user per event:
```sql
CREATE UNIQUE INDEX notification_sent_log_dedup_idx
  ON notification_sent_log (user_id, ticker, event_type, event_id)
  WHERE status = 'sent'
```

### Layer 3: Check Before Insert
`register-notification` checks if notification already exists before inserting.

**Result:** If the same event is processed 1000 times by the scraper, each user still gets exactly 1 email.

## Integration with Scrapers

### Modified: `scrape-watchlist`

**Changes:**
- Added `registerNotifications()` function that calls Edge Function when new items detected
- Modified `runFinviz()` to call `registerNotifications()` with news, ratings, insider data
- Modified `runSecForTicker()` to call `registerNotifications()` with SEC filings
- Notifications are best-effort: failures don't affect scraping

**Example flow:**
```
scrape-watchlist runs
  ↓
findvizScraper returns 2 new news items
  ↓
saveFinvizScrapedItems saves them (returns { new: 2, ... })
  ↓
registerNotifications called for those 2 items
  ↓
register-notification creates pending entries for each user following ticker
  ↓
If registerNotifications fails: logged but doesn't crash scraper
```

## Setup Instructions

### 1. Apply Database Migrations

The migration file `supabase/migrations/20260914020000_add_notification_system.sql` contains:
- `notification_preferences` table creation
- `notification_sent_log` table creation
- RLS policies
- Indexes and constraints

**Apply manually via Supabase dashboard or:**
```bash
supabase migration list
supabase migration up --remote
```

### 2. Create Supabase Secrets

In your Supabase project, go to **Settings → Secrets** and add:

```
RESEND_API_KEY = your_actual_resend_api_key_here
```

**To get your Resend API key:**
1. Go to https://resend.com/api-keys
2. Create new API key
3. Copy and paste into Supabase secrets

### 3. Configure Supabase Secret Keys

The system uses `SUPABASE_SECRET_KEYS` (shared across Edge Functions) to store authorization keys.

This should already be configured in your Supabase environment. The system expects:
```json
{
  "watchlistscheduler": "your_watchlist_scheduler_key",
  "notificationservice": "your_notification_service_key"
}
```

**Important:** These keys must be created and shared in your scheduler setup.

### 4. Deploy Edge Functions

Deploy the notification system Edge Functions:

```bash
# Deploy send-notification-email
supabase functions deploy send-notification-email --use-api

# Deploy register-notification
supabase functions deploy register-notification --use-api
```

**Verify deployment:**
```bash
supabase functions list

# Output should show:
# send-notification-email
# register-notification
```

### 5. Update Frontend

The NotificationPreferences component is ready to use. Add it to your settings/preferences page.

**Example:**
```typescript
// src/pages/SettingsPage.tsx
import { NotificationPreferences } from '../components/NotificationPreferences'

export function SettingsPage() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <NotificationPreferences />
    </div>
  )
}
```

### 6. Manual Testing (Before Production)

**Test 1: Create a notification manually**
```bash
# Register a test notification
curl -X POST https://[PROJECT].supabase.co/functions/v1/register-notification \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "apikey: your_notification_service_key" \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "TEST",
    "event_type": "news",
    "event_id": "test_hash_12345",
    "title": "Test Notification",
    "url": "https://market-ledger.app/company/TEST"
  }'
```

**Check database:**
```sql
SELECT * FROM notification_sent_log WHERE status = 'pending';
```

**Test 2: Send pending notifications**
```bash
curl -X POST https://[PROJECT].supabase.co/functions/v1/send-notification-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "apikey: your_notification_service_key" \
  -H "Content-Type: application/json"
```

**Check results:**
```sql
SELECT * FROM notification_sent_log WHERE status IN ('sent', 'failed');
```

## Email Template

Emails are generated with professional HTML template including:
- Market Ledger branding
- Ticker symbol and event type badge
- Event title
- Source and date information
- Link to view in Market Ledger
- Notification preferences link
- Footer with unsubscribe instructions

Example subjects:
- `[Market Ledger] New news: CTMX`
- `[Market Ledger] New SEC filing: KURA`
- `[Market Ledger] New analyst rating: NTLA`
- `[Market Ledger] New insider trade: CTMX`

## Monitoring and Debugging

### Check pending notifications
```sql
SELECT COUNT(*) as pending_count
FROM notification_sent_log
WHERE status = 'pending';
```

### Check failed notifications
```sql
SELECT user_id, ticker, event_type, error_message, attempts
FROM notification_sent_log
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

### View notification history for a user
```sql
SELECT ticker, event_type, subject, status, sent_at, error_message
FROM notification_sent_log
WHERE user_id = 'user_uuid_here'
ORDER BY created_at DESC
LIMIT 50;
```

### Check user preferences
```sql
SELECT * FROM notification_preferences
WHERE user_id = 'user_uuid_here';
```

### Monitor Edge Function logs
```bash
# View send-notification-email logs
supabase functions logs send-notification-email

# View register-notification logs
supabase functions logs register-notification
```

## Security Considerations

✅ **What's secure:**
- Resend API key stored only in Supabase secrets (not in code, not in .env in git)
- Edge Functions use service-to-service authorization
- User preferences stored in Supabase with RLS policies
- No sensitive data in frontend code
- No localStorage/sessionStorage for preferences

⚠️ **What to monitor:**
- Rate limiting: Resend has rate limits per tier
- Email sending costs: Each notification costs money at Resend
- Database storage: `notification_sent_log` grows continuously (consider archiving old records)

## Troubleshooting

### Notifications not sending
1. Check `notification_sent_log` status: pending? sent? failed?
2. Check Resend API key is configured in Supabase Secrets
3. Check Edge Function logs: `supabase functions logs send-notification-email`
4. Check error_message field in database for specific error

### Duplicate emails
1. Check unique index is created: `SELECT * FROM pg_indexes WHERE tablename = 'notification_sent_log'`
2. Check event_id is correct (should be content_hash)
3. Verify scraper isn't sending different event_ids for same event

### Users not getting preferences created
1. Check they're logged in first
2. Check RLS policies are correct
3. Check their email is in auth.users table

### High Resend API costs
1. Check duplicates aren't being sent
2. Check deduplication constraint is working
3. Consider disabling notifications by default

## Future Enhancements

### Scheduled sending
- Queue notifications to send at specific times (e.g., 9 AM)
- Batch multiple notifications into one email

### User frequency preferences
- "1 email per day" vs "Real-time" vs "Weekly digest"
- User-defined send times

### AI-powered summaries
- AI model summarizes news/filings before sending
- Generate actionable alerts

### SMS/Push notifications
- Alternative channels beyond email
- Multi-channel delivery

### Webhook validation
- Sign Resend webhooks for delivery confirmation
- Track email open rates and clicks

## Files Modified/Created

**New files:**
- `supabase/migrations/20260914020000_add_notification_system.sql`
- `supabase/functions/send-notification-email/index.ts`
- `supabase/functions/register-notification/index.ts`
- `src/components/NotificationPreferences.tsx`

**Modified files:**
- `supabase/functions/scrape-watchlist/index.ts` (added notification integration)
- `src/types.ts` (added notification types)
- `src/styles.css` (added notification preference styles)

**No changes to:**
- React production build (still Static Site on Render)
- Finviz/SEC/StockTwits scrapers (only register notifications)
- Existing database schema (new tables only)
- Authentication flow

## Database Size Estimates

Based on 100 users, 50 tickers tracked, 5 events per ticker per day:
- `notification_sent_log`: ~250 records/day × 30 days = 7,500 records/month
- ~50 KB per record (with email content)
- ~375 MB per year

Recommendation: Archive old records monthly to separate table or external storage.
