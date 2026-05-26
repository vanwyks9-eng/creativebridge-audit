/**
 * CreativeBridge Audit — Supabase Edge Function v6.0
 * Slug: smart-task
 * Report structure (Pro):
 *   executiveSummary          — cross-page only
 *   pages[]                   — per-page: uxScore, categoryScores, keyFindings,
 *                               recommendations, top5Issues, quickWins, phasedRoadmap
 *   nextSteps                 — cross-page closing advice
 * Nothing is averaged or merged across pages.
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

const CATEGORY_RULES: Record<string, string> = {
  ecommerce: `CATEGORY: E-commerce\nHIGHEST PRIORITY CHECKS:\n1. Product finding — clear category hierarchy, usable filters, visible product differences, predictive search\n2. Product page confidence — clear imagery, differentiating detail near buy area, trustworthy reviews\n3. Cost & policy transparency — estimated total cost near buy area, return policy visible before checkout\n4. Checkout friction — guest checkout prominent, optional fields hidden, delivery in actual dates, phone field justified\n5. Post-purchase visibility — order status, delivery updates, account area clarity\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  saas: `CATEGORY: SaaS / Platform\nHIGHEST PRIORITY CHECKS:\n1. Message & offer clarity — clearly states what product does, who it is for, what CTA means\n2. Acquisition friction — no unnecessary login walls, form clutter, paste allowed, mobile-friendly\n3. Time to value & onboarding — first-run reaches meaningful action quickly, empty states guide first step\n4. Pricing & plan comparison — understandable naming, clear feature comparison, transparent pricing\n5. Complex-application clarity — progressive disclosure, visible system status, constructive error messages\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  service: `CATEGORY: Service / Lead generation\nHIGHEST PRIORITY CHECKS:\n1. Trust & legitimacy — design quality, realistic photography, unbiased reviews, multiple contact methods\n2. Service clarity — explains what service is, who for, outcomes, how engagement works\n3. Pricing transparency — exact prices or representative scenarios / starting prices\n4. Lead capture & contact friction — real Contact Us with phone and email, shorter forms\n5. Local proof & booking — visible hours, phone, location, reviews, booking links prominently discoverable\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  corporate: `CATEGORY: Corporate / Informational\nHIGHEST PRIORITY CHECKS:\n1. Homepage orientation — communicates who organisation is, what is here, where to go next\n2. Information scent & wayfinding — descriptive navigation labels, semantic structure, breadcrumbs\n3. About & Contact completeness — About easy to find, authentic; Contact includes real paths\n4. Content clarity & scan-readability — short sentences, subheaded sections, front-loaded titles\n5. Freshness & credibility — current content, explicit dates on news/press pages\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  content: `CATEGORY: Content / Publishing\nHIGHEST PRIORITY CHECKS:\n1. People-first content quality — clear user purpose, enough substance to answer implied question\n2. Authorship, evidence & trust — bylines where expected, references to original sources\n3. Readability & scannability — front-loaded, subheaded chunks, plain language\n4. Long-form navigation — table of contents, anchor-linked headings, clear hierarchy\n5. Reading experience — main content distinguished from ads/clutter, no intrusive interstitials\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  unsure: `CATEGORY: Auto-detect\nIdentify the most likely category from URL and content signals, then apply that category rule pack.\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
};

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

// ── SHARED PAGE JSON TEMPLATE ──────────────────────────────
// Reused verbatim in both single-URL and multi-URL Pro prompts.
const PAGE_JSON_TEMPLATE = (url: string) =>
  `{"url":"${url}","uxScore":0,"categoryScores":[{"category":"First impression","score":0,"maxScore":10,"keyObservations":""},{"category":"Value proposition","score":0,"maxScore":10,"keyObservations":""},{"category":"Visual hierarchy","score":0,"maxScore":10,"keyObservations":""},{"category":"Navigation & IA","score":0,"maxScore":10,"keyObservations":""},{"category":"CTA visibility","score":0,"maxScore":10,"keyObservations":""},{"category":"Accessibility","score":0,"maxScore":10,"keyObservations":""},{"category":"Trust & credibility","score":0,"maxScore":10,"keyObservations":""},{"category":"Conversion friction","score":0,"maxScore":10,"keyObservations":""},{"category":"Mobile experience","score":0,"maxScore":10,"keyObservations":""},{"category":"UX maturity","score":0,"maxScore":10,"keyObservations":""}],"keyFindings":"","recommendations":["","",""],"top5Issues":["","","","",""],"quickWins":["","","","",""],"phasedRoadmap":{"immediate":["","",""],"thirtyDay":["","",""],"longTerm":[]}}`;

// ── PROMPTS ────────────────────────────────────────────────

/**
 * Single-URL Pro audit — one Claude call returns the full report.
 */
function buildSingleProPrompt(form: Record<string, string>): string {
  const rules = CATEGORY_RULES[form.websiteCategory] || CATEGORY_RULES["unsure"];
  const date  = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const url   = form.websiteUrl;

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

WEBSITE: ${url}
Company: ${form.companyName}
Category: ${form.websiteCategory || "auto-detect"}
Goal: ${form.mainGoal}
Target user: ${form.targetUser}
Desired action: ${form.userAction}
Concerns: ${form.concerns || "None"}

${rules}

RULES:
- Score each category independently out of 10. The uxScore is the sum of all category scores.
- top5Issues and quickWins are specific to this page only.
- phasedRoadmap is specific to this page. Include longTerm ONLY if the audit findings justify strategic 60–90 day improvements; otherwise return longTerm as [].
- executiveSummary summarises the UX health of this page (1–2 sentences).
- nextSteps are 3–5 actionable closing recommendations from a senior UX consultant.
- Tone: professional, clear, and actionable throughout.

Return this exact JSON (fill all strings — max 2 sentences each):
{"reportType":"Pro UX Audit","detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","brand":"Creative Bridge","websiteUrl":"${url}","companyName":"${form.companyName}","auditDate":"${date}","generatedFor":"${form.email}","executiveSummary":"","pages":[${PAGE_JSON_TEMPLATE(url)}],"nextSteps":["","","",""]}`;
}

/**
 * Per-page prompt for multi-URL Pro audits.
 * Returns only the data for one specific page.
 */
function buildPagePrompt(form: Record<string, string>, url: string): string {
  const rules = CATEGORY_RULES[form.websiteCategory] || CATEGORY_RULES["unsure"];

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

PAGE: ${url}
Company: ${form.companyName}
Category: ${form.websiteCategory || "auto-detect"}
Goal: ${form.mainGoal}
Target user: ${form.targetUser}
Desired action: ${form.userAction}
Concerns: ${form.concerns || "None"}

${rules}

RULES:
- Analyse this page only. Do not reference other pages.
- Score each category independently out of 10. The uxScore is the sum of all category scores.
- top5Issues and quickWins are specific to this page only — never combined across pages.
- phasedRoadmap is specific to this page. Include longTerm ONLY if audit findings justify strategic 60–90 day improvements for this page; otherwise return longTerm as [].
- Tone: professional, clear, and actionable throughout.

Return this exact JSON (fill all strings — max 2 sentences each):
${PAGE_JSON_TEMPLATE(url)}`;
}

/**
 * Synthesis prompt for multi-URL Pro audits.
 * Receives per-page results and returns only the cross-page sections:
 * executiveSummary and nextSteps.
 */
function buildSynthesisPrompt(form: Record<string, string>, pages: Record<string, unknown>[]): string {
  const pagesContext = pages.map((p, i) => {
    const issues  = ((p.top5Issues  as string[]) || []).slice(0, 3).join("; ");
    const wins    = ((p.quickWins   as string[]) || []).slice(0, 3).join("; ");
    return `Page ${i + 1}: ${p.url}\nScore: ${p.uxScore}/100\nKey Findings: ${p.keyFindings}\nTop Issues: ${issues}\nQuick Wins: ${wins}`;
  }).join("\n\n");

  return `You are a senior UX consultant at Creative Bridge. Return ONLY raw JSON. No markdown. No backticks. Start with { and end with }.

Company: ${form.companyName}
Pages audited (${pages.length}): ${pages.map(p => p.url).join(", ")}

Per-page summaries:
${pagesContext}

Write the two cross-page sections of the report only:
1. executiveSummary — a 2–3 sentence paragraph summarising overall UX health, common patterns, and the most critical issues found across all pages.
2. nextSteps — 3–5 actionable closing recommendations a senior UX consultant would prioritise across all pages. Must always be included.

Return this exact JSON:
{"detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","executiveSummary":"","nextSteps":["","","",""]}`;
}

/**
 * Free-tier prompt — single page, lightweight output.
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
const scoreColor = (s: number, max = 100) => { const p = (s / max) * 100; return p >= 75 ? "#1D7A45" : p >= 55 ? "#B85C00" : "#C22400"; };
const scoreRating = (s: number) => s >= 75 ? "Strong UX Foundation" : s >= 55 ? "Needs Improvement" : "Critical Issues Found";
const catBadgeColor: Record<string, string> = {
  "E-commerce": "#FC2F00", "SaaS": "#2F27CE", "Service": "#1D7A45", "Corporate": "#B85C00", "Content": "#6B6A80",
};

// ── SLIM SUMMARY EMAIL ─────────────────────────────────────
function buildSummaryEmail(r: Record<string, any>, reportUrl: string): string {
  const tier      = r.reportType?.includes("Pro") ? "Pro" : "Free";
  const cat       = r.detectedCategory || "Website";
  const badgeColor = catBadgeColor[cat] || "#2F27CE";

  // For Pro: derive overall score from pages; for Free: use overallScore field
  const pages     = Array.isArray(r.pages) ? r.pages : [];
  const score     = tier === "Pro"
    ? Math.round(pages.reduce((s: number, p: any) => s + (p.uxScore || 0), 0) / Math.max(pages.length, 1))
    : (r.overallScore?.score || 0);
  const rating    = tier === "Pro" ? scoreRating(score) : (r.overallScore?.rating || "");
  const summary   = tier === "Pro" ? (r.executiveSummary || "") : (r.overallScore?.summary || "");
  const isMultiPage = pages.length > 1;

  // Issues and wins from first page (email preview — full breakdown is in the report)
  const firstPage  = pages[0] || {};
  const topIssues  = tier === "Pro"
    ? ((firstPage.top5Issues || []) as string[]).slice(0, 3).map((i: string) =>
        `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #E8E7F5;"><span style="color:#C22400;font-weight:700;flex-shrink:0;font-size:16px;">!</span><span style="font-size:13px;color:#3D3C55;line-height:1.5;">${i}</span></div>`).join("")
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

<!-- HEADER -->
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

<!-- SCORE -->
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

<!-- KEY FINDINGS -->
<tr><td style="background:#fff;padding:28px 40px 0;">
  ${multiPageNote}
  ${isMultiPage ? `<div style="font-size:12px;color:#9998B0;margin-bottom:14px;">Showing top findings from page 1 — full per-page breakdown in your report.</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="48%" style="vertical-align:top;padding-right:12px;">
        <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#C22400;margin-bottom:12px;">Top Issues</div>
        ${topIssues}
      </td>
      <td width="4%"></td>
      <td width="48%" style="vertical-align:top;padding-left:12px;">
        <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1D7A45;margin-bottom:12px;">Quick Wins</div>
        ${topWins}
      </td>
    </tr>
  </table>
</td></tr>

<!-- CTA -->
<tr><td style="background:#fff;padding:32px 40px 40px;">
  <div style="text-align:center;background:#F4F3FF;border-radius:12px;padding:28px;">
    <div style="font-family:'Merriweather Sans',sans-serif;font-size:16px;font-weight:800;color:#0D0A48;margin-bottom:8px;">View your full report</div>
    <div style="font-size:13px;color:#6B6A80;margin-bottom:20px;">${tier === "Pro" ? `Per-page UX scores, category breakdowns, phased roadmap${isMultiPage ? " across all " + pages.length + " pages" : ""}, and recommended next steps.` : "5 category scores, strengths, issues, and quick wins."} Download as PDF to share with your team.</div>
    <a href="${reportUrl}" style="display:inline-block;background:#2F27CE;color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;text-decoration:none;">View & Download Report →</a>
  </div>
  ${tier === "Free" ? `<div style="margin-top:20px;text-align:center;background:#FFF0EC;border:1.5px solid #FC2F00;border-radius:8px;padding:16px;">
    <div style="font-size:13px;color:#C22400;font-weight:600;margin-bottom:6px;">Want the full picture?</div>
    <div style="font-size:12px;color:#6B6A80;margin-bottom:12px;">Pro gives you all 10 categories, conversion friction analysis, and a phased roadmap.</div>
    <a href="https://audit.creativebridge.co.za" style="display:inline-block;background:#FC2F00;color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:13px;padding:10px 24px;border-radius:6px;text-decoration:none;">Upgrade to Pro →</a>
  </div>` : ""}
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#0D0A48;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
  <div style="font-size:12px;color:#6B6A80;">Creative Bridge · AI-powered UX audits · <a href="mailto:hello@creativebridge.co.za" style="color:#8078FF;text-decoration:none;">hello@creativebridge.co.za</a></div>
</td></tr>

</table></td></tr></table><div style="text-align:center;padding:24px 40px;border-top:1px solid #E8E7F5;margin-top:8px;">
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
        // Single URL — one call returns the full report with pages[0]
        const text = await callClaude(buildSingleProPrompt(form), 6000);
        report = parseJSON(text);
      } else {
        // Multi-URL — one call per page, then synthesise cross-page sections
        const pageResults: Record<string, unknown>[] = [];
        for (const url of urls) {
          const text = await callClaude(buildPagePrompt(form, url), 2500);
          pageResults.push(parseJSON(text));
        }

        const synthText = await callClaude(buildSynthesisPrompt(form, pageResults), 2000);
        const synthesis = parseJSON(synthText);

        report = {
          reportType: "Pro UX Audit",
          brand: "Creative Bridge",
          websiteUrl: form.websiteUrl,
          companyName: form.companyName,
          auditDate: date,
          generatedFor: form.email,
          detectedCategory: synthesis.detectedCategory || "",
          executiveSummary: synthesis.executiveSummary || "",
          pages: pageResults,
          nextSteps: synthesis.nextSteps || [],
        };
      }
    } else {
      // Free tier — lightweight single-page report
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
    const form = await req.json();
    const tier  = form.tier === "pro" ? "pro" : "free";
    const email = form.email?.toLowerCase().trim();

    // Test account bypass — skips all restrictions
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
    await supabase.from("audit_submissions").insert({
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
      prompt_version: "v6.0",
      status: "processing",
      created_at: new Date().toISOString(),
    });

    await processAudit(form, submissionId);

    return new Response(JSON.stringify({
      success: true,
      message: "Audit is being processed. Check your email in 1-2 minutes.",
      submissionId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
