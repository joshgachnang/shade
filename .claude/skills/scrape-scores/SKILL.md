---
name: scrape-scores
description: Scrape live trivia scores from 90fmtrivia.org and report results.
---

# Scrape Trivia Scores

## Purpose
Scrape the current trivia contest scores from 90fmtrivia.org and report the results.

## Steps

1. Run the scrape script from the backend directory:

```bash
cd backend && bun run scripts/scrapeScores.ts
```

2. Report the output to the user. If the scrape succeeded, summarize:
   - How many teams were found
   - The current hour
   - Top 5 teams and scores
   - Any errors or warnings

## Notes
- The script connects to MongoDB and upserts scores, and optionally posts to Slack/Bluesky
- Contest hours for 2026: April 17 6PM CT -- April 20 5PM CT
- Outside contest hours the scores page may not be available
