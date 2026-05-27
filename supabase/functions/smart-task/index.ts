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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const RESEND_KEY    = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY  = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
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

// ── EVALUATION FRAMEWORKS ──────────────────────────────────
const FRAMEWORKS = `EVALUATION FRAMEWORKS — apply all of the following to every page:
1. ISO 9241-210: human-centred design — involve users, iterate, evaluate holistically
2. ISO 9241-11: usability as effectiveness, efficiency, and satisfaction in context of use
3. ISO 9241-110: seven interaction principles — suitability for tasks, self-descriptiveness, conformity with user expectations, learnability, controllability, error robustness, user engagement
4. Nielsen Norman Group 10 Heuristics (2024 updated): visibility of system status, match with real world, user control & freedom, consistency & standards, error prevention, recognition over recall, flexibility & efficiency, aesthetic & minimalist design, error recovery, help & documentation
5. GOV.UK task-based benchmarking: assess task success, time to complete, abandonment, perceived difficulty, and user confidence
6. WCAG 2.2: semantic structure, labels, contrast ratios, minimum target size (24×24px), keyboard navigation, error handling, accessible authentication. WCAG 2.2 is the current compliance standard. Do NOT reference WCAG 3 as a current standard — it may only be mentioned as a forward-looking lens if directly relevant
7. Core Web Vitals: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. Classify evidence as field data / lab data / inferred from page structure
8. Information scent: label clarity, predictability of destinations, cognitive effort required. Do NOT penalise pages for click depth alone — the 3-click rule is not supported by evidence and must never be used
9. Content quality: plain language, readability, front-loaded headings, user-focused copy
10. Trust signals: design quality, upfront disclosure, current content, social proof, real contact paths
11. Error message quality: visible, constructive, plainspoken, respectful of user effort`;

// ── MANDATORY PROMPT RULES ─────────────────────────────────
const PROMPT_RULES = `MANDATORY RULES — follow without exception:
- Never use the 3-click rule — it is not supported by evidence. Use information scent instead
- Never reference WCAG 3 as a current compliance standard
- Never imply automated output alone is sufficient for legal accessibility assurance
- Always flag where manual expert review, assistive technology testing, or user research is still required
- Always identify strengths alongside problems — never produce a purely critical report
- Every finding must cite specific observed evidence — never vague opinion
- Scoring model: severity = impact × frequency × business criticality
- Confidence levels: deterministic / high / medium / low / needs human validation
- Evidence classes (use exactly these): "Observed in DOM or page content" | "Inferred from visual analysis" | "Detected by automated rule" | "Likely template issue" | "Needs manual validation"
- Tone: professional, clear, plain English, and actionable throughout`;

// ── JSON PARSER ────────────────────────────────────────────
function parseJSON(text: string): Record<string, unknown> {
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("No JSON found: " + clean.substring(0, 200));
  let depth = 0;
  for (let i = start; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(clean.substring(start, i + 1)); }
        catch (e) { throw new Error("JSON parse failed: " + String(e)); }
      }
    }
  }
  throw new Error("Failed to parse AI response: " + clean.substring(0, 300));
}

// ── CLAUDE HELPER ──────────────────────────────────────────
async function callClaude(prompt: string, maxTokens: number): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
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
  const data = await response.json();
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

Return this exact JSON (fill all strings — max 2 sentences each, except executiveSummary which may be a short paragraph):
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

Analyse this specific page only. Do not reference other pages. Return this exact JSON (max 2 sentences per string):
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
{"reportType":"Free UX Audit","detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","categoryConfidence":"<High|Medium|Low>","brand":"Creative Bridge","websiteUrl":"${form.websiteUrl}","companyName":"${form.companyName}","auditDate":"${date}","generatedFor":"${form.email}","overallScore":{"score":0,"maxScore":100,"rating":"","summary":""},"topIssue":{"title":"","severity":"High","description":""},"topQuickWin":{"recommendation":"","effort":"Low","impact":"High"},"upgradePrompt":{"headline":"Unlock your full UX report","description":"Your free audit shows your score and one key finding. The Pro Audit unlocks all 10 category scores, top 5 issues, 5 quick wins, accessibility review, and a phased improvement roadmap.","cta":"Get the Full Report — R499"}}`;
}

// ── EMAIL HELPERS ──────────────────────────────────────────
const scoreColor  = (s: number, max = 100) => { const p = (s / max) * 100; return p >= 75 ? "#1D7A45" : p >= 55 ? "#B85C00" : "#C22400"; };
const scoreRating = (s: number) => s >= 75 ? "Strong UX Foundation" : s >= 55 ? "Needs Improvement" : "Critical Issues Found";
const catBadgeColor: Record<string, string> = {
  "E-commerce": "#FC2F00", "SaaS": "#2F27CE", "Service": "#1D7A45", "Corporate": "#B85C00", "Content": "#6B6A80",
};

// ── SLIM SUMMARY EMAIL ─────────────────────────────────────
function buildSummaryEmail(r: Record<string, any>, reportUrl: string): string {
  const tier       = r.reportType?.includes("Pro") ? "Pro" : "Free";
  const cat        = r.detectedCategory || "Website";
  const badgeColor = catBadgeColor[cat] || "#2F27CE";
  const pages      = Array.isArray(r.pages) ? r.pages : [];
  const score      = tier === "Pro"
    ? Math.round(pages.reduce((s: number, p: any) => s + (p.uxScore || 0), 0) / Math.max(pages.length, 1))
    : (r.overallScore?.score || 0);
  const rating     = tier === "Pro" ? scoreRating(score) : (r.overallScore?.rating || "");
  const summary    = tier === "Pro" ? (r.executiveSummary || "") : (r.overallScore?.summary || "");
  const isMultiPage = pages.length > 1;
  const firstPage   = pages[0] || {};

  // Issues — handle both structured objects and plain strings
  const topIssues = tier === "Pro"
    ? ((firstPage.top5Issues || []) as any[]).slice(0, 3).map((i: any) => {
        const text = typeof i === "object" ? i.issue : i;
        return `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #E8E7F5;"><span style="color:#C22400;font-weight:700;flex-shrink:0;font-size:16px;">!</span><span style="font-size:13px;color:#3D3C55;line-height:1.5;">${text}</span></div>`;
      }).join("")
    : ((r.issues || []) as any[]).slice(0, 3).map((i: any) =>
        `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #E8E7F5;"><span style="color:#C22400;font-weight:700;flex-shrink:0;font-size:16px;">!</span><span style="font-size:13px;color:#3D3C55;line-height:1.5;">${i.title || ""}</span></div>`).join("");

  const topWins = tier === "Pro"
    ? ((firstPage.quickWins || []) as string[]).slice(0, 3).map((w: string) =>
        `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #E8E7F5;"><span style="color:#1D7A45;font-weight:700;flex-shrink:0;font-size:16px;">✓</span><span style="font-size:13px;color:#3D3C55;line-height:1.5;">${w}</span></div>`).join("")
    : ((r.quickWins || []) as any[]).slice(0, 3).map((w: any) =>
        `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #E8E7F5;"><span style="color:#1D7A45;font-weight:700;flex-shrink:0;font-size:16px;">✓</span><span style="font-size:13px;color:#3D3C55;line-height:1.5;">${w.recommendation || ""}</span></div>`).join("");

  const multiPageNote = isMultiPage
    ? `<div style="margin-bottom:20px;background:#F4F3FF;border-radius:8px;padding:12px 16px;font-size:13px;color:#3D3C55;">
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
  <div style="text-align:center;padding-bottom:32px;border-bottom:1px solid #E8E7F5;">
    <div style="width:100px;height:100px;border-radius:50%;border:5px solid ${scoreColor(score)};display:inline-flex;align-items:center;justify-content:center;flex-direction:column;margin-bottom:16px;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:32px;font-weight:800;color:#0D0A48;line-height:1;">${score}</div>
      <div style="font-size:11px;color:#9998B0;font-weight:600;">/ 100</div>
    </div>
    <div style="font-family:'Merriweather Sans',sans-serif;font-size:20px;font-weight:800;color:#0D0A48;margin-bottom:8px;">${rating}</div>
    <div style="font-size:14px;color:#6B6A80;line-height:1.7;max-width:420px;margin:0 auto;">${summary}</div>
  </div>
</td></tr>
<tr><td style="background:#fff;padding:28px 40px 0;">
  ${multiPageNote}
  ${isMultiPage ? `<div style="font-size:12px;color:#9998B0;margin-bottom:14px;">Showing top findings from page 1 — full per-page breakdown in your report.</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="48%" style="vertical-align:top;padding-right:12px;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#C22400;margin-bottom:12px;">Top Issues</div>
      ${topIssues}
    </td>
    <td width="4%"></td>
    <td width="48%" style="vertical-align:top;padding-left:12px;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1D7A45;margin-bottom:12px;">Quick Wins</div>
      ${topWins}
    </td>
  </tr></table>
</td></tr>
<tr><td style="background:#fff;padding:32px 40px 40px;">
  <div style="text-align:center;background:#F4F3FF;border-radius:12px;padding:28px;">
    <div style="font-family:'Merriweather Sans',sans-serif;font-size:16px;font-weight:800;color:#0D0A48;margin-bottom:8px;">View your full report</div>
    <div style="font-size:13px;color:#6B6A80;margin-bottom:20px;">${tier === "Pro" ? `Per-page UX scores, category breakdowns, strengths, phased roadmap${isMultiPage ? " across all " + pages.length + " pages" : ""}, and next steps.` : "5 category scores, strengths, issues, and quick wins."} Download as PDF to share with your team.</div>
    <a href="${reportUrl}" style="display:inline-block;background:#2F27CE;color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;">View & Download Report →</a>
  </div>
  ${tier === "Free" ? `<div style="margin-top:20px;text-align:center;background:#FFF0EC;border:1.5px solid #FC2F00;border-radius:8px;padding:16px;">
    <div style="font-size:13px;color:#C22400;font-weight:600;margin-bottom:6px;">Want the full picture?</div>
    <div style="font-size:12px;color:#6B6A80;margin-bottom:12px;">Pro gives you all 10 categories, conversion friction analysis, and a phased roadmap.</div>
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
async function processAudit(form: Record<string, string>, submissionId: string) {
  const tier = form.tier === "pro" ? "pro" : "free";
  try {
    let report: Record<string, any>;
    const date = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

    if (tier === "pro") {
      const urls = [form.websiteUrl, form.url_2, form.url_3].filter(Boolean) as string[];

      if (urls.length === 1) {
        const text = await callClaude(buildSingleProPrompt(form), 5000);
        report = parseJSON(text);
      } else {
        const pageResults: Record<string, unknown>[] = [];
        for (const url of urls) {
          const text = await callClaude(buildPagePrompt(form, url), 4000);
          pageResults.push(parseJSON(text));
        }
        const synthText = await callClaude(buildSynthesisPrompt(form, pageResults), 3000);
        const synthesis = parseJSON(synthText);

        report = {
          reportType: "Pro UX Audit",
          brand: "Creative Bridge",
          websiteUrl: form.websiteUrl,
          companyName: form.companyName,
          auditDate: date,
          generatedFor: form.email,
          ...synthesis,
          pages: pageResults,
        };
      }
    } else {
      const text = await callClaude(buildFreePrompt(form), 2000);
      report = parseJSON(text);
    }

    const reportUrl = `${REPORT_BASE}?id=${submissionId}`;
    const html      = buildSummaryEmail(report, reportUrl);
    const subject   = `Your ${report.detectedCategory || ""} UX Audit — ${form.companyName}`;
    await sendEmail(form.email, subject, html);

    await supabase.from("audit_submissions")
      .update({ status: "complete", result: report, email_sent: true, email_sent_at: new Date().toISOString() })
      .eq("id", submissionId);

    console.log("Audit complete:", submissionId);
  } catch (err) {
    console.error("processAudit error:", err);
    await supabase.from("audit_submissions").update({ status: "error" }).eq("id", submissionId);
  }
}

// ── REQUEST HANDLER ────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

    const submissionId = crypto.randomUUID();
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

    // Return response immediately so the browser never times out.
    // EdgeRuntime.waitUntil keeps the Supabase Edge Function alive after the response
    // is sent so processAudit can finish (Claude can take 60-120 s for a Pro audit).
    const auditPromise = processAudit(form, submissionId);
    try {
      // EdgeRuntime is a bare global in the Supabase Edge Runtime — NOT on globalThis.
      // @ts-ignore
      EdgeRuntime.waitUntil(auditPromise);
    } catch (_) {
      // Not in Edge Runtime (local dev) — fall back to synchronous processing.
      await auditPromise;
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Audit is being processed. Check your email in 1-2 minutes.",
      submissionId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Handler error:", msg);
    return new Response(JSON.stringify({ error: msg || "Internal server error. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
