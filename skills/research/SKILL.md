---
name: research
description: Research the live web using TinyFish search and fetch to answer questions and summarize pages
version: 1.0.0
tags:
  - research
  - web
  - search
---

# Research

Use this workflow when you need live-web information you don't already know.

## Steps

1. **Search first.** Call `tinyfish_search` with a focused query. Read the titles, snippets, and domains to pick the most relevant 1-3 result URLs.
2. **Fetch the pages.** Call `tinyfish_fetch` with those URLs (up to 10 at once). The default `markdown` format is best for reading.
3. **Synthesize.** Answer from the fetched content. Prefer primary sources and cite the URL inline.

## Tips

- Make the search query specific; use `site:` to scope to a domain and `-site:` to exclude noise.
- If a fetch returns an entry in `errors[]`, note it and fall back to the next best result rather than failing.
- Fetch up to 10 URLs in one call instead of one at a time.
- Prefer `ttl: 0` only when you need the freshest version; otherwise omit `ttl` to use the cache.
- Search and fetch are free but rate-limited (search 30 req/min, fetch 150 URLs/min). Don't loop aggressively.
