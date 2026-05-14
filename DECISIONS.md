# CreativeBridge Audit — Project Decisions & Architecture

## Overview
AI-powered UX audit tool. User submits a URL, AI analyses it, branded email report is delivered.

## Architecture
```
creativebridge.co.za          → Main marketing site
audit.creativebridge.co.za    → This audit tool (Vercel)
app.creativebridge.co.za      → Future portal/dashboard
```

## Tech Stack
| Layer | Tool | Notes |
|---|---|---|
| Frontend | HTML/CSS/JS | Hosted on Vercel via GitHub |
| Database | Supabase | creativebridge-audit project |
| AI Engine | Claude API (Anthropic) | claude-sonnet-4-5 |
| Email | Resend | Domain verified: creativebridge.co.za |
| Payments | Stripe | Not yet set up |
| Design Tokens | GitHub token.css | https://raw.githubusercontent.com/vanwyks9-eng/design-tokens/main/token.css |

## Key Config
- Supabase URL: https://ptqbabqtuvvyzhbyuaqp.supabase.co
- Edge function slug: smart-task (display name: run-audit)
- Vercel project: creativebridge-audit
- GitHub repo: vanwyks9-eng/creativebridge-audit

## Design System Decisions
- Fonts: Merriweather Sans (display) + Inter (body)
- Icons: Material Symbols Outlined, weight 300 — class: cb-icon
- Primary: rgb(47,39,206) — indigo
- Accent: rgb(252,47,0) — coral red
- Design tokens hosted: github.com/vanwyks9-eng/design-tokens

## Audit Engine Decisions
- Free tier: 5 categories, 3 strengths, 3 issues, 3 quick wins
- Pro tier: 10 categories, executive summary, phased roadmap
- Category rule packs: E-commerce, SaaS, Service, Corporate, Content/Publishing
- Rule pack source: Category Specific UX Rules for AI Website Audits (project file)
- AI auto-detects category if user selects "Not sure"
- Model: claude-sonnet-4-5
- Free prompt: ~2000 tokens max
- Pro prompt: ~4000 tokens max

## Pricing
- Free Audit: R0
- Pro Audit: R499 once-off
- Monthly Monitoring: R999/month

## Version History
| Version | Date | Change |
|---|---|---|
| v1.0.0 | 2026-05-13 | Initial deploy |
| v1.1.0 | 2026-05-14 | Connected form to Supabase edge function |
| v1.1.1 | 2026-05-14 | Corrected edge function URL to smart-task |
| v1.1.2 | 2026-05-14 | Modal close button on all screens |
| v1.1.3 | 2026-05-14 | Corrected edge function endpoint URL |
| v1.1.4 | 2026-05-14 | Fixed Claude model name to claude-sonnet-4-5 |
| v1.2.0 | 2026-05-14 | Wider result modal, side-by-side layout, mail icon |
| v2.0.0 | 2026-05-14 | Category-specific rule packs, dropdown fields, modular email templates |

## Key Files
| File | Location | Purpose |
|---|---|---|
| index.html | GitHub: creativebridge-audit | Full frontend — form, modals, result screen |
| index.ts | Supabase: smart-task edge function | AI audit engine + email delivery |
| token.css | GitHub: design-tokens | Design system tokens |
| create_table.sql | Reference only | Initial DB schema |
| add_category_columns.sql | Reference only | v2.0 schema migration |

## Supabase Table: audit_submissions
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| website_url | TEXT | |
| company_name | TEXT | |
| main_goal | TEXT | Resolved goal label |
| main_goal_type | TEXT | Goal dropdown value |
| target_user | TEXT | |
| user_action | TEXT | |
| concerns | TEXT | Optional |
| email | TEXT | |
| tier | TEXT | free or pro |
| website_category | TEXT | User-selected category |
| detected_category | TEXT | AI-detected category |
| category_confidence | TEXT | High/Medium/Low |
| prompt_version | TEXT | v1, v2 etc |
| status | TEXT | processing/complete/failed |
| result | JSONB | Full audit JSON |
| email_sent | BOOLEAN | |
| email_sent_at | TIMESTAMPTZ | |

## Next Steps (Backlog)
- [ ] Set up Resend domain verification (done)
- [ ] Set up Stripe for Pro audit payments
- [ ] Add rate limiting per email (1 free audit per 24hr)
- [ ] Build sample audit reports for landing page
- [ ] Add PostHog analytics
- [ ] Test Pro audit end to end
- [ ] Build app.creativebridge.co.za portal
