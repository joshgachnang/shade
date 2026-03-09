---
name: rss-reader
description: Read and summarize RSS/Atom feeds to keep the group informed about updates from specified sources.
---

# RSS Feed Reader

## Purpose
Read and summarize RSS/Atom feeds to keep the group informed about updates from specified sources.

## Usage
When asked to read, check, or summarize an RSS feed:

1. Use the `WebFetch` tool to fetch the RSS/Atom feed URL
2. Parse the XML content to extract entries
3. Present the results in a clean, readable format

## Output Format
For each feed item, display:
- **Title** (linked if URL available)
- **Date** published
- **Summary** or description (truncated if lengthy)

Limit to the **10 most recent items** unless the user requests more.

## Example Prompts
- "Read the RSS feed at https://example.com/feed.xml"
- "Check for new posts on https://blog.example.com/rss"
- "Summarize the latest from [feed URL]"

## Notes
- Supports both RSS 2.0 and Atom feed formats
- If the feed URL returns HTML instead of XML, try appending `/feed`, `/rss`, or `/atom.xml` to the URL
- For sites behind authentication or paywalls, the feed may not be accessible
