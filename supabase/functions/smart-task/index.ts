/**
 * CreativeBridge Audit — Supabase Edge Function v7.0
 * Slug: smart-task
 *
 * Report structure (Pro):
 *   executiveSummary              — cross-page
 *   auditScopeAndLimitations      — mandatory, every report
 *   detectedWebsiteType           — category + confidence + priority user goals
 *   pages[]                       — per page: uxScore, categoryScores (with evidenceClass),
 *                                   keyFindings (with evidenceClass), strengths,
 *                                   recommendations, top5Issues (structured),
 *                                   quickWins, phasedRoadmap
 *   nextSteps                     — cross-page closing advice
 *   evidenceAppendix              — URLs, date, methods, exclusions
 *
 * Frameworks applied per page:
 *   ISO 9241-210/11/110 · NNG 10 Heuristics 2024 · GOV.UK task benchmarking
 *   WCAG 2.2 · Core Web Vitals · Information scent · Content quality
 *   Trust signals · Error message quality
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const RESEND_KEY    = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
// SUPABASE_SERVICE_ROLE_KEY is auto-injected by Supabase Edge Runtime.
// SB_SERVICE_ROLE_KEY is the legacy custom secret name — kept as fallback.
const SUPABASE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
                   ?? Deno.env.get("SB_SERVICE_ROLE_KEY")
                   ?? "";
const REPORT_BASE   = "https://audit.creativebridge.co.za/report.html";
const TEST_EMAILS   = ["stephan@creativebridge.co.za"];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── CATEGORY RULE PACKS ────────────────────────────────────
const CATEGORY_RULES: Record<string, string> = {
  ecommerce: `CATEGORY: E-commerce\nHIGHEST PRIORITY CHECKS:\n1. Product finding — clear category hierarchy, usable filters, visible product differences, predictive search\n2. Product page confidence — clear imagery, differentiating detail near buy area, trustworthy reviews\n3. Cost & policy transparency — estimated total cost near buy area, return policy visible before checkout\n4. Checkout friction — guest checkout prominent, optional fields hidden, delivery in actual dates, phone field justified\n5. Post-purchase visibility — order status, delivery updates, account area clarity\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  saas: `CATEGORY: SaaS / Platform\nHIGHEST PRIORITY CHECKS:\n1. Message & offer clarity — clearly states what product does, who it is for, what CTA means\n2. Acquisition friction — no unnecessary login walls, form clutter, paste allowed, mobile-friendly\n3. Time to value & onboarding — first-run reaches meaningful action quickly, empty states guide first step\n4. Pricing & plan comparison — understandable naming, clear feature comparison, transparent pricing\n5. Complex-application clarity — progressive disclosure, visible system status, constructive error messages\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  service: `CATEGORY: Service / Lead generation\nHIGHEST PRIORITY CHECKS:\n1. Trust & legitimacy — design quality, realistic photography, unbiased reviews, multiple contact methods\n2. Service clarity — explains what service is, who for, outcomes, how engagement works\n3. Pricing transparency — exact prices or representative scenarios / starting prices\n4. Lead capture & contact friction — real Contact Us with phone and email, shorter forms\n5. Local proof & booking — visible hours, phone, location, reviews, booking links prominently discoverable\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  corporate: `CATEGORY: Corporate / Informational\nHIGHEST PRIORITY CHECKS:\n1. Homepage orientation — communicates who organisation is, what is here, where to go next\n2. Information scent & wayfinding — descriptive navigation labels, semantic structure, breadcrumbs\n3. About & Contact completeness — About easy to find, authentic; Contact includes real paths\n4. Content clarity & scan-readability — short sentences, subheaded sections, front-loaded titles\n5. Freshness & credibility — current content, explicit dates on news/press pages\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  content: `CATEGORY: Content / Publishing\nHIGHEST PRIORITY CHECKS:\n1. People-first content quality — clear user purpose, enough substance to answer implied question\n2. Authorship, evidence & trust — bylines where expected, references to original sources\n3. Readability & scannability — front-loaded, subheaded chunks, plain language\n4. Long-form navigation — table of contents, anchor-linked headings, clear hierarchy\n5. Reading experience — main content distinguished from ads/clutter, no intrusive interstitials\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  unsure: `CATEGORY: Auto-detect\nIdentify the most likely category from URL and content signals, then apply that category rule pack.\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
};

// ── EVALUATION FRAMEWORKS (compact) ───────────────────────
// Kept concise to minimise input-token count and response latency.
const FRAMEWORKS = `FRAMEWORKS (apply all): ISO 9241-210 (human-centred design) · ISO 9241-11 (effectiveness, efficiency, satisfaction) · ISO 9241-110 (suitability, self-descriptiveness, conformity, learnability, controllability, error robustness, engagement) · NNG 10 Heuristics 2024 (visibility, real-world match, user control, consistency, error prevention, recognition over recall, flexibility, minimal design, error recovery, help) · GOV.UK task benchmarking (success, time, abandonment, confidence) · WCAG 2.2 — current standard (semantic structure, labels, contrast, 24×24px targets, keyboard, error handling) · Core Web Vitals (LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 — classify all as inferred) · Information scent (label clarity, destination predictability) · Content quality (plain language, front-loaded headings) · Trust signals (design quality, disclosure, social proof, contact) · Error messages (visible, constructive, plainspoken)`;

// ── MANDATORY PROMPT RULES (compact) ──────────────────────
const PROMPT_RULES = `RULES: Never use the 3-click rule — use information scent instead. WCAG 2.2 is the current standard — do NOT reference WCAG 3 as current. Never imply automated output alone is sufficient for accessibility compliance — flag where manual review is required. Always identify strengths alongside problems. Every finding must cite specific observed evidence. Evidence classes (use exactly): "Observed in DOM or page content" | "Inferred from visual analysis" | "Detected by automated rule" | "Likely template issue" | "Needs manual validation". Tone: professional, clear, actionable.`;

// ── JSON PARSER (self-healing) ─────────────────────────────
// Handles truncated Claude responses using three progressive strategies.
function parseJSON(text: string): Record<string, unknown> {
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("No JSON found: " + clean.substring(0, 200));

  // Pass 1: full response — happy path when JSON is complete.
  try { return JSON.parse(clean.slice(start)); } catch (_) {}

  // Pass 2: specific repair for v7.0 reports truncated inside nextSteps or
  // evidenceAppendix. Those sections come AFTER pages[], so we can safely
  // drop them and still deliver a complete page analysis.
  for (const marker of [',"nextSteps":', ',"evidenceAppendix":']) {
    const idx = clean.indexOf(marker, start);
    if (idx !== -1) {
      // Close the outer object right after the pages array.
      const candidate = clean.slice(start, idx) + "}";
      try {
        const result = JSON.parse(candidate);
        console.warn(`parseJSON repaired: stripped from '${marker}' (${clean.length} chars total)`);
        return result;
      } catch (_) {}
    }
  }

  // Pass 3: walk backwards from each } — catches other truncation patterns.
  let pos = clean.lastIndexOf("}");
  while (pos > start) {
    try {
      const result = JSON.parse(clean.slice(start, pos + 1));
      console.warn(`parseJSON repaired via backwards-search at char ${pos}/${clean.length}`);
      return result;
    } catch (_) {
      pos = clean.lastIndexOf("}", pos - 1);
    }
  }

  const tail = clean.substring(Math.max(0, clean.length - 300));
  throw new Error(`Failed to parse AI response (${clean.length} chars). Tail: ...${tail}`);
}

// ── CLAUDE HELPER ──────────────────────────────────────────
// timeoutMs is per-call; callers pass a value appropriate for their token budget.
async function callClaude(prompt: string, maxTokens: number, timeoutMs = 70_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system: "You are a senior UX consultant. Return ONLY raw JSON. No markdown. No backticks. Start with { end with }.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    throw new Error(`Claude fetch failed: ${String(fetchErr)}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const stopReason = data.stop_reason ?? "unknown";
  console.log(`Claude ok — stop:${stopReason} in:${data.usage?.input_tokens} out:${data.usage?.output_tokens} max:${maxTokens}`);
  if (stopReason === "max_tokens") {
    console.error(`TRUNCATION WARNING: Claude hit max_tokens (${maxTokens}) — response is incomplete.`);
  }
  return data.content?.[0]?.text ?? "{}";
}

// ── PER-PAGE JSON TEMPLATE ─────────────────────────────────
const PAGE_JSON_TEMPLATE = (url: string) =>
  `{"url":"${url}","detectedPageType":"","uxScore":0,"categoryScores":[{"category":"First impression","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Value proposition","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Visual hierarchy","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Navigation & IA","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"CTA effectiveness","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Accessibility (WCAG 2.2)","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Trust & credibility","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Conversion & friction","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Mobile experience","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""},{"category":"Performance & Core Web Vitals","score":0,"maxScore":10,"keyObservations":"","evidenceClass":""}],"keyFindings":[{"finding":"","evidenceClass":""},{"finding":"","evidenceClass":""},{"finding":"","evidenceClass":""}],"strengths":["",""],"recommendations":["","",""],"top5Issues":[{"issue":"","where":"","principleViolated":"","severity":"High","businessImpact":""},{"issue":"","where":"","principleViolated":"","severity":"High","businessImpact":""},{"issue":"","where":"","principleViolated":"","severity":"Medium","businessImpact":""},{"issue":"","where":"","principleViolated":"","severity":"Medium","businessImpact":""},{"issue":"","where":"","principleViolated":"","severity":"Low","businessImpact":""}],"quickWins":["","","","",""],"phasedRoadmap":{"immediate":["","",""],"thirtyDay":["","",""],"longTerm":[]}}`;

// ── PROMPTS ────────────────────────────────────────────────

/**
 * Single-URL Pro — one call returns the complete report.
 */
function buildSingleProPrompt(form: Record<string, string>): string {
  const rules = CATEGORY_RULES[form.websiteCategory] || CATEGORY_RULES["unsure"];
  const date  = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const url   = form.websiteUrl;

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

AUDIT CONTEXT:
WEBSITE: ${url}
AUDIT_GOAL: Full UX audit
WEBSITE_TYPE: Auto-detect from URL and content — state category (brochure / lead-gen / ecommerce / SaaS / booking / content publisher) and confidence level
PRIMARY_AUDIENCE: ${form.targetUser} — assess whether the experience suits novice or expert users
TOP_TASKS: Derive from goal (${form.mainGoal}) and desired action (${form.userAction})
DEVICE_CONTEXT: Mobile-first, then desktop
PERFORMANCE_BASELINE: Infer from page structure and content signals — classify all evidence as inferred
ACCESSIBILITY_TARGET: WCAG 2.2 (current standard)
LOCALE_AND_LANGUAGE: Auto-detect from URL and page content
SCORING_MODEL: severity = impact × frequency × business criticality. Confidence = deterministic / high / medium / low / needs human validation
LIMITATION_DISCLOSURES: State what was not crawled, what was inferred, and what requires manual or user testing to validate

Company: ${form.companyName}
Category hint: ${form.websiteCategory || "auto-detect"}
Stated goal: ${form.mainGoal}
Desired user action: ${form.userAction}
Concerns: ${form.concerns || "None stated"}

${rules}

${FRAMEWORKS}

${PROMPT_RULES}

Return this exact JSON (be concise — max 1 sentence per string field; executiveSummary max 3 sentences):
{"reportType":"Pro UX Audit","detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","categoryConfidence":"<High|Medium|Low>","detectedWebsiteType":{"category":"<brochure|lead-gen|ecommerce|SaaS|booking|content publisher>","confidence":"<High|Medium|Low>","priorityUserGoals":["",""]},"localeAndLanguage":"","brand":"Creative Bridge","websiteUrl":"${url}","companyName":"${form.companyName}","auditDate":"${date}","generatedFor":"${form.email}","executiveSummary":"","auditScopeAndLimitations":{"audited":"","inferred":"","notCrawled":"","requiresValidation":""},"pages":[${PAGE_JSON_TEMPLATE(url)}],"nextSteps":["","","",""],"evidenceAppendix":{"urlsAudited":["${url}"],"auditDate":"${date}","auditScopeMode":"Automated AI analysis — all evidence inferred","confidencePerPage":[{"url":"${url}","confidence":""}],"methodsUsed":["AI content and structure analysis","Heuristic evaluation against NNG 10 / ISO 9241","WCAG 2.2 inferred assessment","Core Web Vitals inferred from page structure"],"exclusions":["Dynamic content not visible without interaction","Server-side or real-user performance metrics","Assistive technology testing","Legal accessibility assurance","User testing and task observation"]}}`;
}

/**
 * Per-page prompt — multi-URL Pro, one call per URL.
 */
function buildPagePrompt(form: Record<string, string>, url: string): string {
  const rules = CATEGORY_RULES[form.websiteCategory] || CATEGORY_RULES["unsure"];

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

AUDIT CONTEXT:
PAGE: ${url}
AUDIT_GOAL: Full UX audit — this page only
WEBSITE_TYPE: Auto-detect from URL and content
PRIMARY_AUDIENCE: ${form.targetUser}
TOP_TASKS: Derive from goal (${form.mainGoal}) and action (${form.userAction})
DEVICE_CONTEXT: Mobile-first, then desktop
PERFORMANCE_BASELINE: Infer from page signals — classify evidence as inferred
ACCESSIBILITY_TARGET: WCAG 2.2
LOCALE_AND_LANGUAGE: Auto-detect from URL
LIMITATION_DISCLOSURES: State what was not crawled and what needs manual validation

Company: ${form.companyName}
Category hint: ${form.websiteCategory || "auto-detect"}
Stated goal: ${form.mainGoal}
Desired user action: ${form.userAction}
Concerns: ${form.concerns || "None stated"}

${rules}

${FRAMEWORKS}

${PROMPT_RULES}

Analyse this specific page only. Do not reference other pages. Return this exact JSON (be concise — max 1 sentence per string field):
${PAGE_JSON_TEMPLATE(url)}`;
}

/**
 * Synthesis prompt — multi-URL Pro, generates cross-page sections only.
 */
function buildSynthesisPrompt(form: Record<string, string>, pages: Record<string, unknown>[]): string {
  const date = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const urls = pages.map(p => p.url as string);

  const pagesContext = pages.map((p, i) => {
    const findings = ((p.keyFindings as any[]) || []).map((f: any) =>
      typeof f === "object" ? f.finding : f).slice(0, 3).join("; ");
    const issues = ((p.top5Issues as any[]) || []).map((iss: any) =>
      typeof iss === "object" ? iss.issue : iss).slice(0, 3).join("; ");
    return `Page ${i + 1}: ${p.url}\nScore: ${p.uxScore}/100\nKey Findings: ${findings}\nTop Issues: ${issues}`;
  }).join("\n\n");

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

Company: ${form.companyName}
Pages audited (${pages.length}): ${urls.join(", ")}

Per-page summaries:
${pagesContext}

${PROMPT_RULES}

Write the cross-page sections of the report only. executiveSummary must include one paragraph per URL submitted. nextSteps must always be present. auditScopeAndLimitations is mandatory. Return this exact JSON:
{"detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","categoryConfidence":"<High|Medium|Low>","detectedWebsiteType":{"category":"","confidence":"","priorityUserGoals":["",""]},"localeAndLanguage":"","executiveSummary":"","auditScopeAndLimitations":{"audited":"","inferred":"","notCrawled":"","requiresValidation":""},"nextSteps":["","","",""],"evidenceAppendix":{"urlsAudited":${JSON.stringify(urls)},"auditDate":"${date}","auditScopeMode":"Automated AI analysis — all evidence inferred","confidencePerPage":${JSON.stringify(urls.map(u => ({ url: u, confidence: "" })))},"methodsUsed":["AI content and structure analysis","Heuristic evaluation against NNG 10 / ISO 9241","WCAG 2.2 inferred assessment","Core Web Vitals inferred from page structure"],"exclusions":["Dynamic content not visible without interaction","Server-side or real-user performance metrics","Assistive technology testing","Legal accessibility assurance","User testing and task observation"]}}`;
}

/**
 * Free tier — lightweight single-page report, flat structure unchanged.
 */
function buildFreePrompt(form: Record<string, string>): string {
  const rules = CATEGORY_RULES[form.websiteCategory] || CATEGORY_RULES["unsure"];
  const date  = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

WEBSITE: ${form.websiteUrl}
Company: ${form.companyName}
Goal: ${form.mainGoal}
Target user: ${form.targetUser}
Desired action: ${form.userAction}
Concerns: ${form.concerns || "None"}

${rules}

Return this exact JSON (keep strings concise — max 2 sentences each):
{"reportType":"Free UX Audit","detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","categoryConfidence":"<High|Medium|Low>","brand":"Creative Bridge","websiteUrl":"${form.websiteUrl}","companyName":"${form.companyName}","auditDate":"${date}","generatedFor":"${form.email}","overallScore":{"score":0,"maxScore":100,"rating":"","summary":""},"criticalCategories":[{"category":"","score":0,"maxScore":10,"keyObservations":""},{"category":"","score":0,"maxScore":10,"keyObservations":""}],"topIssues":[{"title":"","severity":"High","description":"","impact":""},{"title":"","severity":"High","description":"","impact":""},{"title":"","severity":"Medium","description":"","impact":""}],"topQuickWins":[{"recommendation":"","effort":"Low","impact":"High"},{"recommendation":"","effort":"Low","impact":"High"}],"recommendation":"","upgradePrompt":{"headline":"Unlock your full UX report","description":"Your free audit covers your top 2 critical categories, 3 key issues and 2 quick wins. Pro unlocks all 10 categories, top 5 issues, 5 quick wins, conversion analysis, and a phased roadmap.","cta":"Get the Full Report — R499"}}`;
}

// ── EMAIL HELPERS ──────────────────────────────────────────
const scoreColor  = (s: number, max = 100) => { const p = (s / max) * 100; return p >= 75 ? "#1D7A45" : p >= 55 ? "#B85C00" : "#C22400"; };
const scoreRating = (s: number) => s >= 75 ? "Strong UX Foundation" : s >= 55 ? "Needs Improvement" : "Critical Issues Found";
const catBadgeColor: Record<string, string> = {
  "E-commerce": "#FC2F00", "SaaS": "#2F27CE", "Service": "#1D7A45", "Corporate": "#B85C00", "Content": "#6B6A80",
};

// ── SLIM SUMMARY EMAIL ─────────────────────────────────────
function buildSummaryEmail(r: Record<string, any>, reportUrl: string): string {
  const tier        = r.reportType?.includes("Pro") ? "Pro" : "Free";
  const cat         = r.detectedCategory || "Website";
  const badgeColor  = catBadgeColor[cat] || "#2F27CE";
  const pages       = Array.isArray(r.pages) ? r.pages : [];
  const score       = tier === "Pro"
    ? Math.round(pages.reduce((s: number, p: any) => s + (p.uxScore || 0), 0) / Math.max(pages.length, 1))
    : (r.overallScore?.score || 0);
  const rating      = tier === "Pro" ? scoreRating(score) : (r.overallScore?.rating || "");
  const summary     = tier === "Pro" ? (r.executiveSummary || "") : (r.overallScore?.summary || "");
  const isMultiPage = pages.length > 1;
  const firstPage   = pages[0] || {};

  // ── Email component helpers ────────────────────────────────
  const sectionHead = (label: string, color: string) =>
    `<div style="font-family:'Merriweather Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color};margin:28px 0 12px;">${label}</div>`;

  // Category snapshot row
  const catPct = (s: number, m: number) => (s / m) * 100;
  const catColor = (s: number, m: number) => catPct(s,m) >= 70 ? "#1D7A45" : catPct(s,m) >= 50 ? "#B85C00" : "#C22400";
  const catRow = (cat: string, score: number, max: number, obs: string) =>
    `<tr>
      <td style="padding:10px 8px 10px 0;font-size:13px;color:#232225;font-weight:600;border-bottom:1px solid #F0EEFF;vertical-align:top;">${cat}</td>
      <td style="padding:10px 8px;font-size:15px;font-weight:800;color:${catColor(score,max)};white-space:nowrap;border-bottom:1px solid #F0EEFF;vertical-align:top;">${score}<span style="font-size:10px;font-weight:400;color:#9998B0;">/${max}</span></td>
      <td style="padding:10px 0 10px 8px;font-size:12px;color:#6B6A80;line-height:1.5;border-bottom:1px solid #F0EEFF;vertical-align:top;">${obs}</td>
    </tr>`;

  // Strength card (green)
  const strengthCard = (text: string) =>
    `<div style="background:#EAFAF1;border:1px solid #B7E4C7;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <span style="font-size:13px;font-weight:700;color:#1D7A45;margin-right:6px;">✓</span><span style="font-size:13px;color:#3D3C55;line-height:1.55;">${text}</span>
    </div>`;

  // Issue card (amber) — title + severity badge + description + impact
  const issueCard = (title: string, sev: string, desc: string, impact: string) => {
    const sc = sev === "High" ? "#C22400" : sev === "Medium" ? "#B85C00" : "#1D7A45";
    return `<div style="background:#FFF8E1;border:1px solid #F5C98A;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="margin-bottom:${desc ? "6px" : "0"};">
        <span style="font-size:13px;font-weight:700;color:#232225;">${title}</span>
        <span style="background:${sc};color:#fff;border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700;margin-left:8px;">${sev}</span>
      </div>
      ${desc ? `<div style="font-size:12px;color:#3D3C55;line-height:1.55;${impact ? "margin-bottom:5px;" : ""}">${desc}</div>` : ""}
      ${impact ? `<div style="font-size:11px;color:#6B6A80;font-style:italic;">Impact: ${impact}</div>` : ""}
    </div>`;
  };

  // Quick win row
  const winRow = (text: string) =>
    `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #E8E7F5;">
      <span style="color:#1D7A45;font-weight:700;flex-shrink:0;font-size:16px;">✓</span>
      <span style="font-size:13px;color:#3D3C55;line-height:1.5;">${text}</span>
    </div>`;

  // ── Build sections ─────────────────────────────────────────

  // Category snapshot
  const catSnapshotRows = tier === "Pro"
    ? ((firstPage.categoryScores || []) as any[]).slice(0, 3)
        .map((c: any) => catRow(c.category||"", c.score||0, c.maxScore||10, c.keyObservations||"")).join("")
    // Free: criticalCategories[] (new) or empty
    : ((r.criticalCategories || []) as any[]).slice(0, 2)
        .map((c: any) => catRow(c.category||"", c.score||0, c.maxScore||10, c.keyObservations||"")).join("");

  const catSnapshotLockNote = tier === "Free"
    ? `<tr><td colspan="3" style="padding:10px 0 0;font-size:11px;color:#9998B0;font-style:italic;">🔒 All 10 categories unlocked in the Pro report</td></tr>`
    : (isMultiPage ? `<tr><td colspan="3" style="padding:10px 0 0;font-size:11px;color:#9998B0;">Showing top categories from page 1 — full breakdown in your report</td></tr>` : "");

  const catSnapshotHtml = catSnapshotRows ? `
    ${sectionHead("Category Snapshot", "#2F27CE")}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr style="border-bottom:2px solid #DDDBFF;">
        <th style="text-align:left;padding:0 8px 8px 0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9998B0;">Category</th>
        <th style="text-align:left;padding:0 8px 8px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9998B0;">Score</th>
        <th style="text-align:left;padding:0 0 8px 8px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9998B0;">Summary</th>
      </tr>
      ${catSnapshotRows}
      ${catSnapshotLockNote}
    </table>` : "";

  // Strengths (Pro only — strings from firstPage.strengths)
  const strengthsHtml = tier === "Pro" && (firstPage.strengths || []).length
    ? `${sectionHead("Key Strengths", "#1D7A45")}
       ${((firstPage.strengths || []) as string[]).slice(0, 3).map(strengthCard).join("")}`
    : "";

  // Issues
  const issuesHtml = (() => {
    let cards = "";
    if (tier === "Pro") {
      cards = ((firstPage.top5Issues || []) as any[]).slice(0, 3).map((i: any) =>
        issueCard(typeof i === "object" ? i.issue : i, i.severity||"High", "", typeof i === "object" ? i.businessImpact||"" : "")).join("");
    } else {
      // New format: topIssues[] | old compat: topIssue{}
      const issues = Array.isArray(r.topIssues) ? r.topIssues
        : (r.topIssue ? [r.topIssue] : []);
      cards = (issues as any[]).slice(0, 3).map((i: any) =>
        issueCard(i.title||"", i.severity||"High", i.description||"", i.impact||"")).join("");
    }
    return cards ? `${sectionHead("Main UX Issues", "#C22400")}${cards}` : "";
  })();

  // Quick wins
  const winsHtml = (() => {
    let rows = "";
    if (tier === "Pro") {
      rows = ((firstPage.quickWins || []) as string[]).slice(0, 3).map(winRow).join("");
    } else {
      // New: topQuickWins[] | old compat: topQuickWin{}
      const wins = Array.isArray(r.topQuickWins) ? r.topQuickWins
        : (r.topQuickWin ? [r.topQuickWin] : []);
      rows = (wins as any[]).slice(0, 2).map((w: any) =>
        winRow(typeof w === "string" ? w : (w.recommendation || ""))).join("");
    }
    return rows ? `${sectionHead("Quick Wins", "#1D7A45")}${rows}` : "";
  })();

  // Recommendation (Free only)
  const recHtml = tier === "Free" && r.recommendation
    ? `<div style="margin-top:20px;background:#EEF2FF;border-left:4px solid #2F27CE;border-radius:4px;padding:12px 16px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#2F27CE;margin-bottom:6px;">Recommendation</div>
        <div style="font-size:13px;color:#3D3C55;line-height:1.6;">${r.recommendation}</div>
       </div>`
    : "";

  const multiPageNote = isMultiPage
    ? `<div style="margin-bottom:16px;background:#F4F3FF;border-radius:8px;padding:12px 16px;font-size:13px;color:#3D3C55;">
        <strong style="color:#2F27CE;">${pages.length} pages audited:</strong> ${pages.map((p: any) => `<a href="${p.url}" style="color:#2F27CE;">${p.url}</a>`).join(" · ")}
       </div>`
    : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Merriweather+Sans:wght@400;600;700;800&family=Inter:wght@400;500&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background:#F4F3FF;font-family:'Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3FF;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#0D0A48;border-radius:12px 12px 0 0;padding:32px 40px 28px;">
  <div style="font-family:'Merriweather Sans',sans-serif;font-weight:800;font-size:20px;color:#fff;margin-bottom:4px;">Creative<span style="color:#FF9070;">Bridge</span> <span style="color:#6B6A80;font-weight:400;">/</span> <span style="color:#9998B0;font-weight:500;font-size:15px;">Audit</span></div>
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(47,39,206,0.3);">
    <span style="background:${badgeColor};color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:3px 12px;border-radius:100px;">${cat} ${tier} Audit</span>
  </div>
  <div style="margin-top:12px;">
    <div style="font-size:13px;color:#9998B0;">Website: <a href="${r.websiteUrl || ""}" style="color:#B8B4FF;">${r.websiteUrl || ""}</a></div>
    <div style="font-size:13px;color:#9998B0;margin-top:3px;">Company: <span style="color:#fff;">${r.companyName || ""}</span> &nbsp;·&nbsp; ${r.auditDate || ""}</div>
  </div>
</td></tr>
<tr><td style="background:#fff;padding:40px 40px 0;">
  <div style="text-align:center;padding-bottom:28px;border-bottom:1px solid #E8E7F5;">
    <div style="width:100px;height:100px;border-radius:50%;border:5px solid ${scoreColor(score)};display:inline-flex;align-items:center;justify-content:center;flex-direction:column;margin-bottom:16px;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:32px;font-weight:800;color:#0D0A48;line-height:1;">${score}</div>
      <div style="font-size:11px;color:#9998B0;font-weight:600;">/ 100</div>
    </div>
    <div style="font-family:'Merriweather Sans',sans-serif;font-size:20px;font-weight:800;color:#0D0A48;margin-bottom:8px;">${rating}</div>
    <div style="font-size:14px;color:#6B6A80;line-height:1.7;max-width:420px;margin:0 auto;">${summary}</div>
  </div>
  ${multiPageNote ? `<div style="padding-top:20px;">${multiPageNote}</div>` : ""}
  ${catSnapshotHtml}
  ${strengthsHtml}
  ${issuesHtml}
  ${winsHtml}
  ${recHtml}
</td></tr>
<tr><td style="background:#fff;padding:28px 40px 40px;">
  <div style="text-align:center;background:#F4F3FF;border-radius:12px;padding:28px;">
    <div style="font-family:'Merriweather Sans',sans-serif;font-size:16px;font-weight:800;color:#0D0A48;margin-bottom:8px;">View your full report</div>
    <div style="font-size:13px;color:#6B6A80;margin-bottom:20px;">${tier === "Pro" ? `Per-page UX scores, category breakdowns, strengths, phased roadmap${isMultiPage ? " across all " + pages.length + " pages" : ""}, and next steps.` : "Full category breakdown, all issues, quick wins, and a personalised roadmap."} Download as PDF to share with your team.</div>
    <a href="${reportUrl}" style="display:inline-block;background:#2F27CE;color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;">View & Download Report →</a>
  </div>
  ${tier === "Free" ? `<div style="margin-top:20px;text-align:center;background:#FFF0EC;border:1.5px solid #FC2F00;border-radius:8px;padding:16px;">
    <div style="font-size:13px;color:#C22400;font-weight:600;margin-bottom:6px;">Want the full picture?</div>
    <div style="font-size:12px;color:#6B6A80;margin-bottom:12px;">Pro unlocks all 10 categories, 5 issues, 5 quick wins, conversion analysis, and a phased roadmap.</div>
    <a href="https://audit.creativebridge.co.za" style="display:inline-block;background:#FC2F00;color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:13px;padding:10px 24px;border-radius:6px;text-decoration:none;">Upgrade to Pro →</a>
  </div>` : ""}
</td></tr>
<tr><td style="background:#0D0A48;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
  <div style="font-size:12px;color:#6B6A80;">Creative Bridge · AI-powered UX audits · <a href="mailto:hello@creativebridge.co.za" style="color:#8078FF;text-decoration:none;">hello@creativebridge.co.za</a></div>
</td></tr>
</table></td></tr></table>
<div style="text-align:center;padding:24px 40px;border-top:1px solid #E8E7F5;margin-top:8px;">
  <p style="font-size:11px;color:#9998B0;margin:0;line-height:1.6;">You received this email because you requested a UX audit from Creative Bridge.<br>
  <a href="mailto:audit@creativebridge.co.za?subject=unsubscribe" style="color:#9998B0;">Unsubscribe</a> &nbsp;·&nbsp; <a href="https://audit.creativebridge.co.za" style="color:#9998B0;">audit.creativebridge.co.za</a></p>
</div>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: "Creative Bridge Audit <audit@creativebridge.co.za>",
      to: [to], subject, html,
      reply_to: "audit@creativebridge.co.za",
      headers: {
        "List-Unsubscribe": "<mailto:audit@creativebridge.co.za?subject=unsubscribe>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  const data = await res.json();
  console.log("Resend:", JSON.stringify(data));
  return data;
}

// ── AUDIT PROCESSOR ────────────────────────────────────────
// Returns the report object so the handler can pass it back in the response.
// Errors propagate to the handler — real error messages surface in the modal.
async function processAudit(form: Record<string, string>, submissionId: string): Promise<Record<string, any>> {
  try { await supabase.from("audit_submissions").update({ status: "running" }).eq("id", submissionId); } catch (_) {}
  console.log("processAudit started — id:", submissionId);

  const tier = form.tier === "pro" ? "pro" : "free";
  const date = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

  let report: Record<string, any>;

  if (tier === "pro") {
    const urls = [form.websiteUrl, form.url_2, form.url_3].filter(Boolean) as string[];

    if (urls.length === 1) {
      // At ~1.4 chars/token, the v7.0 single-URL template generates ~5500-7000 chars.
      // 6000 tokens gives headroom; 120 s covers slow Claude runs (worst: 6000/50 tok/s = 120 s).
      // Total wall-clock: 120 s + ~10 s overhead = 130 s — within Supabase's 150 s limit.
      // 8192 is the Claude Sonnet output ceiling. At ~0.9 chars/token the v7.0
      // template produces ~7000-8000 chars; 8192 always fits.
      // 130 s timeout: 8192 tok @ 80 tok/s ≈ 102 s + TTFT = ~107 s.
      // Total wall-clock: 107 s + ~10 s overhead = ~117 s — within 150 s limit.
      console.log("Calling Claude — single-URL Pro (max 8192 tokens, 130 s timeout)...");
      const text = await callClaude(buildSingleProPrompt(form), 8192, 130_000);
      report = parseJSON(text);
    } else {
      // Per-page calls run in parallel; wall-clock = slowest page, not sum.
      // 4500 tokens per page / 90 s timeout; 3-URL worst case: 90 s + 40 s synthesis ≈ 135 s.
      console.log("Calling Claude — parallel page analysis for", urls.length, "URLs...");
      const pageResults = await Promise.all(
        urls.map(async (url) => {
          const text = await callClaude(buildPagePrompt(form, url), 6000, 110_000);
          return parseJSON(text);
        })
      );
      // Synthesis is cross-page text only — 1200 tokens is ample, 40 s timeout.
      console.log("Calling Claude — synthesis...");
      const synthText = await callClaude(buildSynthesisPrompt(form, pageResults), 1200, 40_000);
      const synthesis = parseJSON(synthText);
      report = {
        reportType: "Pro UX Audit", brand: "Creative Bridge",
        websiteUrl: form.websiteUrl, companyName: form.companyName,
        auditDate: date, generatedFor: form.email,
        ...synthesis, pages: pageResults,
      };
    }
  } else {
    // Free template now has 2 categories + 3 issues + 2 wins — 1800 tokens, 50 s timeout.
    console.log("Calling Claude — Free tier...");
    const text = await callClaude(buildFreePrompt(form), 1800, 50_000);
    report = parseJSON(text);
  }

  console.log("Claude done — building email...");
  const reportUrl = `${REPORT_BASE}?id=${submissionId}`;
  const html      = buildSummaryEmail(report, reportUrl);
  const subject   = `Your ${report.detectedCategory || ""} UX Audit — ${form.companyName}`;

  const emailResult = await sendEmail(form.email, subject, html);
  console.log("Resend result id:", emailResult?.id ?? "MISSING");
  if (!emailResult?.id) {
    throw new Error(`Email delivery failed: ${JSON.stringify(emailResult).slice(0, 300)}`);
  }

  const { error: dbErr } = await supabase.from("audit_submissions")
    .update({ status: "complete", result: report, email_sent: true, email_sent_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (dbErr) {
    // Throw so the handler surfaces the real DB error to the frontend modal.
    // The email was already sent; this only affects the report viewer link.
    throw new Error(`DB save failed (email sent): ${JSON.stringify(dbErr)}`);
  }

  console.log("Audit complete:", submissionId);
  return report;
}

// ── REQUEST HANDLER ────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Declare submissionId outside try so the catch block can update DB on error.
  let submissionId: string | undefined;

  try {
    const form  = await req.json();
    const tier  = form.tier === "pro" ? "pro" : "free";
    const email = form.email?.toLowerCase().trim();

    const isTestAccount = TEST_EMAILS.includes(email);

    if (!isTestAccount) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("audit_submissions")
        .select("*", { count: "exact", head: true })
        .eq("email", email)
        .gte("created_at", since);

      const limit = tier === "pro" ? 5 : 3;
      if ((count ?? 0) >= limit) {
        return new Response(JSON.stringify({
          error: `Rate limit reached. You can run ${limit} audits per 24 hours. Please try again later.`
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    submissionId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("audit_submissions").insert({
      id: submissionId,
      website_url: form.websiteUrl,
      url_2: form.url_2 || null,
      url_3: form.url_3 || null,
      company_name: form.companyName,
      main_goal: form.mainGoal,
      target_user: form.targetUser,
      user_action: form.userAction,
      concerns: form.concerns,
      email: form.email,
      tier,
      prompt_version: "v7.0",
      status: "processing",
      created_at: new Date().toISOString(),
    });
    if (insertError) console.error("DB insert error:", JSON.stringify(insertError));

    // processAudit throws on any failure — errors surface as real error modals.
    const report = await processAudit(form, submissionId);

    // Return the full report in the response so the frontend can cache it in
    // sessionStorage. report.html reads from sessionStorage first, bypassing
    // the Supabase anon query entirely for the immediate click-through.
    return new Response(JSON.stringify({
      success: true,
      message: "Your audit is complete — check your inbox!",
      submissionId,
      report,
      tier,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Handler error:", msg);
    // Update DB status to error if we have a submissionId
    if (submissionId) {
      try { await supabase.from("audit_submissions").update({ status: "error" }).eq("id", submissionId); } catch (_) {}
    }
    return new Response(JSON.stringify({ error: msg || "Internal server error. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
