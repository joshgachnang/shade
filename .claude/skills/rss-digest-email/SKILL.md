---
name: rss-digest-email
description: Fetch RSS/Atom feeds, summarize articles, compile into a PDF digest, and email it.
---

# RSS/Atom Feed Digest & Email Skill

## Purpose
Fetch all configured RSS/Atom feeds, summarize each article, compile into a PDF with summaries up front (linked to full articles appended at the end), and email the PDF to a specified address.

## Feed Configuration
Feeds should be provided by the user or stored in a scheduled task prompt. Example format:
```
feeds:
- https://example.com/feed.xml
- https://blog.example.com/rss
```

## Workflow

### Step 1: Fetch Feeds
For each feed URL:
1. Use `WebFetch` to retrieve the RSS/Atom XML
2. Parse out article entries: title, link, published date, and content/description

### Step 2: Fetch Full Article Content
For each article found in the feeds:
1. Use `WebFetch` to fetch the full article page
2. Extract the main article text content
3. Store both the summary snippet (from feed) and full content (from page)

### Step 3: Generate the Digest PDF
Use a bash script to create the PDF. The document structure should be:

```
DAILY DIGEST — [Date]

TABLE OF CONTENTS / SUMMARIES
For each article:
  [#] Title (Source) — Date
  Summary: 2-3 sentence AI-generated summary
  → See full article on page X

FULL ARTICLES
For each article:
  [Anchor #]
  Title
  Source | Date | Original URL
  Full article text
```

### Step 4: Build the PDF
Use one of these approaches (in order of preference):

**Option A — pandoc + wkhtmltopdf (preferred):**
```bash
# Generate markdown digest, then convert
pandoc digest.md -o digest.pdf --pdf-engine=wkhtmltopdf
```

**Option B — Python with reportlab or weasyprint:**
```bash
pip install weasyprint 2>/dev/null
python3 -c "
import weasyprint
# Generate HTML string with summaries + full articles
# Convert to PDF
weasyprint.HTML(string=html_content).write_pdf('digest.pdf')
"
```

**Option C — Markdown → HTML → PDF via wkhtmltopdf:**
```bash
# Write HTML file with internal anchor links
wkhtmltopdf digest.html digest.pdf
```

### Step 5: Email the PDF
Use one of these approaches:

**Option A — Python SMTP:**
```bash
python3 -c "
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders

msg = MIMEMultipart()
msg['Subject'] = 'Daily RSS Digest — [Date]'
msg['From'] = sender
msg['To'] = recipient

msg.attach(MIMEText('Your daily RSS digest is attached.'))

with open('digest.pdf', 'rb') as f:
    part = MIMEBase('application', 'octet-stream')
    part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', 'attachment; filename=digest.pdf')
    msg.attach(part)

context = __import__('ssl').create_default_context()
with smtplib.SMTP_SSL('smtp.fastmail.com', 465, context=context) as s:
    s.login(user, password)
    s.send_message(msg)
"
```

**Option B — mutt:**
```bash
echo "Your daily RSS digest is attached." | mutt -s "Daily RSS Digest" -a digest.pdf -- recipient@example.com
```

## Invocation
When the user asks to run the RSS digest, they should provide:
1. **Feed URLs** — list of RSS/Atom feed URLs
2. **Email address** — where to send the PDF
3. **SMTP credentials** (if not already configured) — server, port, username, password

## Example Usage
```
Run my RSS digest with these feeds:
- https://hnrss.org/frontpage
- https://feeds.arstechnica.com/arstechnica/index
Email to: user@example.com
```

## Notes
- Summaries should be AI-generated (2-3 sentences capturing key points)
- The PDF should use internal anchor links so clicking a summary jumps to the full article
- Articles should be sorted by date (newest first)
- If a feed fails to load, log the error and continue with remaining feeds
- The digest filename should include the date: `digest-2026-03-08.pdf`
