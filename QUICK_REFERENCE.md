# QUICK REFERENCE: Data Inconsistency Issues

## The Problem in 30 Seconds

### Dashboard shows:
```
KURA
630 SEC
Updated Sep 9, 8:00 PM
```

### CompanyWorkspace shows:
```
813 eventos
───────────
SEC 3 — Sep 10, 2026
SEC 4 — Sep 10, 2026
...
```

## Root Causes

| Issue | Why | Impact |
|-------|-----|--------|
| **630 vs 813** | 630 = SEC only. 813 = SEC + News + Ratings + Insider | Confusing: looks like missing data |
| **Sep 9 vs Sep 10** | Dashboard shows max of ALL items. Activity shows each item's date. | Dates don't match what user expects |
| **Multiple timezones** | Dashboard uses America/New_York. Activity uses UTC. Header uses browser timezone. | Same date appears different in different places |
| **Too much data loaded** | Query fetches 1000+ items but shows only summary | ~4 MB of data for a quick view |

## Quick Fixes Roadmap

### Priority 1: Clarify the counts
```
CURRENT:
  813 eventos

SHOULD BE:
  News      105
  SEC       630
  Ratings    20
  Insiders   58
  ─────────────
  Total     813
```

### Priority 2: Fix timezone confusion
```
CURRENT: Last updated: Sep 9, 2026  [which timezone? confusing]

SHOULD BE:
  Latest News:    Sep 10, 2026
  Latest SEC:     Sep 10, 2026
  Latest Ratings: Sep 12, 2026
  Latest Insider: Sep 11, 2026
```

### Priority 3: Lazy load the activity feed
```
CURRENT: Loads 1000 items at once (~4 MB)

SHOULD BE: Load 50 items initially (~50 KB)
           Load more on scroll
```

## Files Affected

| File | Current Behavior | What to Change |
|------|-----------------|-----------------|
| [src/components/intelligence/IntelligenceView.tsx](src/components/intelligence/IntelligenceView.tsx) | Shows "813 eventos" | Show 4 separate counts |
| [src/pages/CompanyWorkspacePage.tsx](src/pages/CompanyWorkspacePage.tsx) | Shows "Last updated: Sep 14, 2026" | Show per-type latest dates |
| [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx) | Shows "630 SEC" + shared lastUpdated | Separate the counts logic |
| [src/lib/queries/company.ts](src/lib/queries/company.ts) | Fetches 1000 items for summary | Consider pagination/lazy load |

## Database Queries Status

| Query | Limit | Issue | Priority |
|-------|-------|-------|----------|
| scraped_items | 1000 ⚠️ | Too many for UI | P1 |
| finviz_analyst_ratings | None ⚠️ | Could be 1000+ rows | P2 |
| finviz_insider_trades | None ⚠️ | Could be 1000+ rows | P2 |

## No Schema Changes Needed

✅ All fixes are UI/logic only  
✅ No database migrations required  
✅ No Edge Function changes needed  
✅ No RLS policy changes needed  

## Before You Code

Check in DB (as verification, don't modify):
```sql
-- Check KURA's actual counts
SELECT 
  (SELECT COUNT(*) FROM scraped_items 
   WHERE ticker='KURA' AND item_type != 'post'
   AND NOT (metadata->>'source' = 'SEC' OR metadata->>'accessionNumber' IS NOT NULL)
  ) as news_count,
  (SELECT COUNT(*) FROM scraped_items 
   WHERE ticker='KURA' 
   AND (metadata->>'source' = 'SEC' OR metadata->>'accessionNumber' IS NOT NULL)
  ) as sec_count,
  (SELECT COUNT(*) FROM finviz_analyst_ratings WHERE ticker='KURA') as ratings_count,
  (SELECT COUNT(*) FROM finviz_insider_trades WHERE ticker='KURA') as insider_count;
```

Should output something like:
```
news_count: 105
sec_count: 630
ratings_count: 20
insider_count: 58
```

If those sum to 813, everything is working correctly—just the UI is confusing.

## Exact Lines to Review

- [IntelligenceView.tsx:10-14](src/components/intelligence/IntelligenceView.tsx#L10-L14) — How SEC detection works
- [IntelligenceView.tsx:24-26](src/components/intelligence/IntelligenceView.tsx#L24-L26) — Where "813" is calculated
- [DashboardPage.tsx:35](src/pages/DashboardPage.tsx#L35) — Where "630" is calculated
- [CompanyWorkspacePage.tsx:8](src/pages/CompanyWorkspacePage.tsx#L8) — Where "Last updated" is calculated
- [company.ts:18](src/lib/queries/company.ts#L18) — The `.limit(1000)` in scraped_items query

## Full Details

👉 See [AUDIT_REPORT.md](AUDIT_REPORT.md) for exhaustive analysis
