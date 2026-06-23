# YouTube Video Planning Guide
> Template + History for turning articles into unscripted videos

---

## About This File

This document captures:
1. **Channel context** — what works on this channel (from analytics)
2. **Creator style** — unscripted, straight to camera
3. **The framework** — how to turn an article into a video plan
4. **History** — every article analyzed so far with the output

Use this as context when analyzing a new article. Feed it to the AI along with the new article URL.

---

## Channel Context (from YouTube Studio Analytics — Mar 23 to Apr 19, 2026)

### Channel Profile
- **Niche:** AI tools, local AI, self-hosting, developer tools, Mac setup, Bunny.net/CDN/VPS
- **Audience:** Cost-conscious developers and tech enthusiasts
- **Total period stats:** 53,439 engaged views | 1,529 watch hours | 206 new subscribers | $108.64 revenue
- **Daily views:** ~1,650–2,400/day (stable, slight upward trend)

### What Performs Best (by engaged views)
| # | Video | Engaged Views | CTR | Avg View % |
|---|-------|--------------|-----|------------|
| 1 | How to Get Claude Opus 4.5 FREE for Coding | 5,518 | 15.63% | 21% |
| 2 | Hermes Does What Most AI Agents Can't *(32s Short)* | 5,003 | 3.55% | 92% |
| 3 | Local AI on Mac Mini M4 | 3,334 | 12.59% | 11.22% |
| 4 | GLM 5 Turbo vs MiMO-V2-Pro vs MinimaxM2.7 | 2,168 | 10.12% | 14.37% |
| 5 | Qwen 3.5 Review — Is a 4B Model Good at Coding? | 2,056 | 10.6% | 13.42% |

### Title Patterns That Drive High CTR
- **"FREE"** or free alternative angle → 15%+ CTR
- **Price anchor** ("$3", "$6", "$0.26") → 10–14% CTR
- **"vs." battle format** → consistently 10%+ CTR
- **"STOP using X"** / problem-first framing → strong performer
- Avoid: generic model names alone, no promise in title

### Content Categories With High CPM (revenue per impression)
- Terminal/setup guides (Ghostty: ~$8 RPM)
- Self-hosting tutorials (OpenFang, ZeroClaw)
- AI tool setup walkthroughs
> These are evergreen — views keep coming 3–4 months after publish

### Shorts Strategy
- Shorts get 4× more impressions than long-form but earn ~10× less per view
- Use Shorts as top-of-funnel: tease the long-form, drive to channel
- Best performing shorts: curiosity-gap titles, 30–60 seconds, 60%+ retention

### Retention Problem
- **55% of viewers leave before minute 1** (channel average)
- Average view percentage channel-wide: **13.8%**
- Best long-form retention achieved: **21%** (5-min video)
- Target: 20–25% avg view percentage on long-form

---

## Creator Style: Unscripted, Straight To Camera

The creator does **not write scripts**. They go directly in front of the camera and talk.

### What This Means For Every Video Plan
1. **No full script** — only give a hook sentence + bullet point flow
2. **Hook must be memorizable** — one sentence, natural language, says itself
3. **Flow = max 5 bullets** — words/phrases, not sentences
4. **Highlight "money moments"** — the 2–3 facts they MUST say out loud
5. **Flag retention killers** — what NOT to do in this specific video
6. **Screen content list** — what to show on screen at each stage

### General Retention Rules For Unscripted Videos
- **First 60 seconds is everything** — hook must name the pain + make a promise
- **No "hey guys welcome back"** — start with the hook, nothing before it
- **Pattern interrupt every 60–90 seconds** — a surprising stat, a comparison, a demo moment
- **Show before you explain** — demo the result first, then walk through how
- **Never recap what you just said** — keep moving forward
- **Target length:** 
  - Setup/tutorial content: 12–15 min
  - AI tool reviews/comparisons: 7–10 min
  - Shorts: 30–60 sec

### On-Camera Habits To Avoid
- Long intros explaining what the video will cover
- Apologetic hedging ("this might not work for everyone...")
- Reading tables out loud — show them on screen, highlight 2–3 numbers
- Over-explaining sections the audience already knows (e.g. what Astro is to a dev audience)
- Recapping: "so as I mentioned earlier..."

---

## The Framework: Article → Video Plan

When analyzing a new article, produce the following 5 sections:

### 1. Hook (1 sentence)
The opener the creator says the moment they hit record. Must:
- Name a specific pain OR a specific surprising result
- Include a number or price if possible (specificity = credibility)
- Sound like something you'd say to a friend, not a presenter

### 2. Sticky Note (the flow)
Max 5 bullet points. Words only, not sentences. This is taped next to the camera.

### 3. Money Moments (2–3 facts)
The most compelling data points from the article. Must be said out loud. Include suggested phrasing.

### 4. Section-by-Section Breakdown
Timestamped guide through the video. For each section: what to say + what to show on screen.

### 5. Title Options (3 variants)
Based on the channel's proven CTR patterns: FREE, price anchor, vs. battle, or problem-first framing.

---

## History of Analyzed Articles

---

### Entry 001 — Deploy Astro on Bunny.net
**Date analyzed:** 2026-04-20
**Article URL:** https://www.bitdoze.com/deploy-astro-bunny-net/
**Article topic:** How to host a static Astro site on Bunny.net edge storage + CDN

#### Key Facts From Article
- Cost: **$0.26/month** for a typical blog (under $4/year)
- Bunny bandwidth: **$0.01/GB** vs Vercel $0.15/GB vs Netlify $0.10/GB
- 119+ edge locations, global replication, automatic Let's Encrypt SSL
- No server maintenance — upload files, Bunny serves them
- Free 14-day trial, no credit card required
- Creator runs their own Astro site on Bunny.net (personal credibility)
- Bunny Shield (WAF + DDoS) included in free tier
- Cloudflare Pages has better free tier; Bunny wins at scale and for edge storage replication

#### Hook
> *"I'm hosting my Astro site on a global CDN with automatic SSL and DDoS protection for 26 cents a month. Let me show you how."*

#### Sticky Note
```
1. WHY BUNNY  → cost comparison ($0.01/GB vs Vercel $0.15/GB)
2. SETUP      → storage zone → pull zone (2 min each)
3. DEPLOY     → build dist/ → upload via script or manual
4. DOMAIN     → add hostname → CNAME → SSL auto
5. END        → real cost breakdown → link in description
```

#### Money Moments
1. **Price comparison** (show table on screen):
   > *"Vercel charges $0.15 per gigabyte. Netlify $0.10. Bunny charges $0.01. That's 15 times cheaper."*

2. **Real monthly cost** (show breakdown table):
   > *"500MB of storage, 25GB of bandwidth — comes out to 26 cents a month. Under $4 a year. And that includes DDoS protection."*

3. **No-maintenance angle:**
   > *"No VPS to patch. No Docker container to babysit. You upload your files, Bunny serves them from 119 locations worldwide."*

#### Section Breakdown
| Timestamp | What to say | Show on screen |
|-----------|-------------|----------------|
| 0:00–0:30 | Hook + overview of what we're building | Intro / article thumbnail |
| 0:30–2:00 | Why Bunny over Cloudflare/Vercel — hit the price point, mention CF free tier is better if cost is only concern | Comparison table from article |
| 2:00–6:00 | Create storage zone (pick region = can't change later) → create pull zone (name becomes CDN URL) | Live Bunny dashboard |
| 6:00–10:00 | `npm run build` → show dist/ folder → upload via API script | Terminal + Bunny dashboard |
| 10:00–13:00 | Add custom hostname → CNAME vs ANAME explainer → Force SSL toggle | DNS settings + Bunny hostname panel |
| 13:00–14:30 | Show cost table → say the 26 cents line → CTA | Cost breakdown table |

#### Retention Killers to Avoid (specific to this video)
- Don't explain what Astro is — audience knows, they clicked for Bunny
- Don't read the comparison table out loud — show it, highlight 3 numbers
- Don't deep-dive every caching option — mention Smart Cache, say "defaults are fine", move on
- Don't spend more than 60 seconds on Bunny Shield — mention free DDoS, done

#### Title Options
1. `Host Your Astro Site for $0.26/month on Bunny.net (Full Setup)` ← **recommended**
2. `Stop Paying Vercel Prices — Host Astro on Bunny.net for Pennies`
3. `Bunny.net Astro Hosting: Cheaper Than Everything, Better Than Most`

#### Target Length
12–15 minutes (setup/tutorial category — audience tolerates longer if always on screen doing something)

---

*Add new entries below as new articles are analyzed.*

---

### Entry 002 — VPS AI Coding Setup
**Date analyzed:** 2026-04-20
**Article URL:** https://www.bitdoze.com/vps-ai-coding-setup/
**Article topic:** Full VPS setup to run an AI coding agent (opencode) 24/7, accessible from Zed, VS Code, and browser via Termix

#### Key Facts From Article
- A 2 vCPU / 4GB RAM VPS is enough — opencode is lightweight, LLM API does the heavy work (~$4–5/month)
- Hetzner offers €20 free credit (affiliate link in article)
- Full setup takes ~30 minutes
- Stack: SSH key auth → locked user → CrowdSec (auto-bans brute-force) → Starship + Catppuccin → opencode → tmux (persistent sessions) → Zed remote / VS Code remote / Termix browser terminal
- tmux keeps the AI agent running after you disconnect and close your laptop
- opencode supports 70+ LLM providers (Anthropic, OpenAI, Google, etc.)
- Termix = web terminal in any browser, including phone/iPad
- Zed has built-in remote dev support — editor UI on Mac, files/processes on server

#### Hook
> *"I moved my AI coding agent off my laptop onto a VPS and now it runs 24/7, my laptop stays cool, and I can connect from my phone. The whole setup takes 30 minutes. Let me show you."*

#### Sticky Note
```
1. WHY VPS    → laptop fan / battery / disconnects = AI stops
2. SERVER     → Hetzner + SSH keys + locked user + CrowdSec
3. TERMINAL   → Starship + Catppuccin (optional but nice)
4. OPENCODE   → install + API key + tmux = runs when lid closed
5. CONNECT    → Zed remote / VS Code remote / Termix browser
```

#### Money Moments
1. **The tmux payoff — the visual star of the video:**
   > *"You close your laptop. The AI keeps coding. You reconnect tomorrow morning, it's exactly where you left it."*

2. **Cheap server is enough:**
   > *"opencode itself is lightweight — a 2 vCPU, 4GB RAM server does the job because the heavy lifting happens in the LLM API, not on your machine. That's a $4–5 VPS."*

3. **Connect from anything:**
   > *"Zed on your Mac, VS Code, or a full terminal from your browser on your iPad — all hitting the same server, same session."*

#### Section Breakdown
| Timestamp | What to say | Show on screen |
|-----------|-------------|----------------|
| 0:00–0:30 | Hook + overview of what we're building | Intro |
| 0:30–2:00 | Why VPS: laptop fan/battery/AI stops when lid closes. Hetzner €20 credit. 2vCPU+4GB is enough — API does the work | Hetzner pricing page |
| 2:00–5:00 | SSH key generation on Mac → add to agent → first login as root → apt update → add swap | Mac terminal |
| 5:00–9:00 | Create aidev user → sudo no-password → copy SSH key → **TEST login before locking** → harden sshd_config | VPS terminal |
| 9:00–12:00 | CrowdSec install → firewall bouncer → iptables block → make persistent → verify running | VPS terminal |
| 12:00–14:00 | Starship install → Catppuccin Mocha (one curl). Say: "optional, skip if you just want the agent" | Terminal with new prompt |
| 14:00–17:00 | opencode install → API key → start → **tmux demo**: start session, run opencode, detach, disconnect, reconnect, reattach — show it's still there | Terminal — this is the payoff |
| 17:00–19:00 | SSH config alias on Mac → Zed remote connection → open folder → run opencode in Zed terminal | Zed IDE |
| 19:00–20:30 | VS Code Remote SSH (brief) → mention Termix for browser access, link in description | VS Code |
| 20:30–21:30 | Wrap: 3-sentence recap → Hetzner link → CTA | Terminal / outro |

#### Retention Killers to Avoid (specific to this video)
- Don't explain what opencode is for more than 30 seconds — audience clicked for the VPS setup
- Don't do the Starship section before opencode — it's cosmetic and kills momentum
- Don't walk through every iptables rule line by line — paste the block, say what it does in one sentence, move on
- **The tmux demo is your best moment** — don't rush it. Detach, fully disconnect SSH, reconnect, reattach. Let the viewer see it's still running. That's the payoff of the entire video
- Don't demo both Zed AND VS Code in depth — do Zed fully, mention VS Code works the same way, link the guide

#### Title Options
1. `Run AI Coding Agents 24/7 on a $5 VPS — Full Setup Guide` ← **recommended**
2. `Stop Frying Your Laptop — Move Your AI Agent to a VPS (30 Min Setup)`
3. `opencode on VPS: SSH + CrowdSec + Zed Remote Full Setup`

#### Target Length
18–22 minutes — multi-step server setup. Audience will follow if you're always in the terminal. Cut any section where you stop showing the screen.

