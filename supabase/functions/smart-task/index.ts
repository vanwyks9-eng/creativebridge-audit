/**
 * CreativeBridge Audit — Supabase Edge Function v3.1
 * Slug: smart-task
 * Fix: Returns 200 immediately, processes Claude in background using waitUntil
 * This bypasses the Supabase free tier wall-clock timeout
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const RESEND_KEY    = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY  = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_RULES: Record<string, string> = {
  ecommerce: `CATEGORY: E-commerce\nHIGHEST PRIORITY CHECKS:\n1. Product finding — clear category hierarchy, usable filters, visible product differences, predictive search\n2. Product page confidence — clear imagery, differentiating detail near buy area, trustworthy reviews\n3. Cost & policy transparency — estimated total cost near buy area, return policy visible before checkout\n4. Checkout friction — guest checkout prominent, optional fields hidden, delivery in actual dates, phone field justified\n5. Post-purchase visibility — order status, delivery updates, account area clarity\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals (LCP<2.5s, INP<200ms, CLS<0.1), mobile, trust signals`,
  saas: `CATEGORY: SaaS / Platform\nHIGHEST PRIORITY CHECKS:\n1. Message & offer clarity — clearly states what product does, who it is for, what CTA means; penalise generic "Get started"\n2. Acquisition friction — no unnecessary login walls, form clutter, paste allowed, mobile-friendly, accessible auth\n3. Time to value & onboarding — first-run reaches meaningful action quickly, empty states guide first step, contextual help\n4. Pricing & plan comparison — understandable naming, clear feature comparison (max 5 options), transparent pricing\n5. Complex-application clarity — progressive disclosure, visible system status, constructive error messages\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  service: `CATEGORY: Service / Lead generation\nHIGHEST PRIORITY CHECKS:\n1. Trust & legitimacy — design quality, realistic photography, unbiased reviews, multiple ways to reach a real person\n2. Service clarity — explains what service is, who for, outcomes, how engagement works, staff bios\n3. Pricing transparency — exact prices or representative scenarios / starting prices\n4. Lead capture & contact friction — real Contact Us with phone and email, shorter forms, digestible steps\n5. Local proof & booking — visible hours, phone, location, reviews, booking links prominently discoverable\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  corporate: `CATEGORY: Corporate / Informational\nHIGHEST PRIORITY CHECKS:\n1. Homepage orientation — communicates who organisation is, what is here, where to go next; no vague marketing language\n2. Information scent & wayfinding — descriptive navigation labels, semantic structure, breadcrumbs on deep pages\n3. About & Contact completeness — About easy to find, authentic; Contact includes real paths not just a form\n4. Content clarity & scan-readability — short sentences, subheaded sections, front-loaded titles, plain language\n5. Freshness & credibility — current content, explicit dates on news/press pages\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  content: `CATEGORY: Content / Publishing\nHIGHEST PRIORITY CHECKS:\n1. People-first content quality — clear user purpose, enough substance to answer implied question, exists for readers\n2. Authorship, evidence & trust — bylines where expected, references to original sources for claims\n3. Readability & scannability — front-loaded, subheaded chunks, plain language the audience uses\n4. Long-form navigation — table of contents, anchor-linked headings, clear hierarchy\n5. Reading experience — main content distinguished from ads/clutter, no intrusive interstitials, no layout shift\n6. Freshness honesty — page dates reflect actual updates, not manipulated\nUNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
  unsure: `CATEGORY: Auto-detect\nIdentify the most likely category from URL and content signals:\n- cart/checkout/SKU = E-commerce\n- "free trial"/"book demo"/"pricing plans" = SaaS\n- "book now"/"request quote"/service area = Service\n- articles/bylines/tags/categories = Content/Publishing\n- otherwise = Corporate/Informational\nThen apply that category rule pack. UNIVERSAL BASELINE: accessibility (WCAG 2.2), Core Web Vitals, mobile, trust signals`,
};

function parseJSON(text: string): Record<string, unknown> {
  try {
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (_) {}
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (_) {}
  throw new Error("Failed to parse AI response: " + text.substring(0, 300));
}

function buildPrompt(form: Record<string, string>, tier: string): string {
  const rules = CATEGORY_RULES[form.websiteCategory] || CATEGORY_RULES["unsure"];
  const date = new Date().toLocaleDateString("en-ZA", { day:"numeric", month:"long", year:"numeric" });

  if (tier === "pro") {
    return `You are a senior UX consultant at Creative Bridge.\nReturn ONLY a raw JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }.\n\nWEBSITE: ${form.websiteUrl}\nCompany: ${form.companyName}\nCategory: ${form.websiteCategory || "auto-detect"}\nGoal: ${form.mainGoal}\nTarget user: ${form.targetUser}\nDesired action: ${form.userAction}\nConcerns: ${form.concerns || "None"}\n\n${rules}\n\nEvaluate all 10 categories. Weight the category rule pack checks most heavily.\n\nReturn this exact JSON:\n{"reportType":"Pro UX Audit","detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","categoryConfidence":"<High|Medium|Low>","brand":"Creative Bridge","websiteUrl":"${form.websiteUrl}","companyName":"${form.companyName}","auditDate":"${date}","generatedFor":"${form.email}","websiteOverview":{"primaryGoal":"${form.mainGoal}","targetAudience":"${form.targetUser}","desiredUserAction":"${form.userAction}","knownConcerns":"${form.concerns || "None"}"},"overallScore":{"score":0,"maxScore":100,"rating":"","summary":""},"categoryScores":[{"category":"First impression","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"High"},{"category":"Clarity of value proposition","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"High"},{"category":"Visual hierarchy","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"Medium"},{"category":"Navigation and information architecture","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"Medium"},{"category":"Call-to-action visibility","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"High"},{"category":"Accessibility and readability","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"High"},{"category":"Trust and credibility","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"Medium"},{"category":"Conversion friction","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"High"},{"category":"Mobile experience","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"Medium"},{"category":"Overall UX maturity","score":0,"maxScore":10,"keyObservations":"","uxIssues":[],"recommendedImprovements":[],"priority":"Medium"}],"top5Issues":["","","","",""],"top5QuickWins":["","","","",""],"recommendedNextSteps":["","",""],"executiveSummary":"","phasedRoadmap":{"immediate":["",""],"thirtyDay":["",""],"longTerm":["",""]}}\n\nFill in all empty string values and 0 scores with real audit content specific to this site.`;
  } else {
    return `You are a senior UX consultant at Creative Bridge.\nReturn ONLY a raw JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }.\n\nWEBSITE: ${form.websiteUrl}\nCompany: ${form.companyName}\nCategory: ${form.websiteCategory || "auto-detect"}\nGoal: ${form.mainGoal}\nTarget user: ${form.targetUser}\nDesired action: ${form.userAction}\nConcerns: ${form.concerns || "None"}\n\n${rules}\n\nEvaluate exactly 5 categories most relevant to this site type (score 0-10 each).\nRating: 90-100=Excellent, 75-89=Strong, 60-74=Needs Improvement, 40-59=Weak, 0-39=Critical\n\nReturn this exact JSON:\n{"reportType":"Free UX Audit","detectedCategory":"<E-commerce|SaaS|Service|Corporate|Content>","categoryConfidence":"<High|Medium|Low>","brand":"Creative Bridge","websiteUrl":"${form.websiteUrl}","companyName":"${form.companyName}","auditDate":"${date}","generatedFor":"${form.email}","websiteOverview":{"primaryGoal":"${form.mainGoal}","targetAudience":"${form.targetUser}","desiredUserAction":"${form.userAction}","knownConcerns":"${form.concerns || "None"}"},"overallScore":{"score":0,"maxScore":100,"rating":"","summary":""},"categoryScores":[{"category":"","score":0,"maxScore":10,"summary":""},{"category":"","score":0,"maxScore":10,"summary":""},{"category":"","score":0,"maxScore":10,"summary":""},{"category":"","score":0,"maxScore":10,"summary":""},{"category":"","score":0,"maxScore":10,"summary":""}],"strengths":[{"title":"","description":""},{"title":"","description":""},{"title":"","description":""}],"issues":[{"title":"","severity":"High","description":"","impact":""},{"title":"","severity":"Medium","description":"","impact":""},{"title":"","severity":"Medium","description":"","impact":""}],"quickWins":[{"recommendation":"","effort":"Low","impact":"High"},{"recommendation":"","effort":"Medium","impact":"High"},{"recommendation":"","effort":"Low","impact":"Medium"}],"upgradePrompt":{"headline":"Unlock the full UX report","description":"The Pro Audit includes all 10 category-specific UX checks, conversion friction analysis, accessibility review, prioritised recommendations, and a phased improvement roadmap.","cta":"Upgrade to Pro Audit"}}\n\nFill in all empty string values with real audit content. Replace score 0 values with real scores.`;
  }
}

const scoreColor = (s: number, max = 10) => { const p=(s/max)*100; return p>=75?"#1D7A45":p>=60?"#B85C00":"#C22400"; };
const sevColor   = (s: string) => s==="High"?"#C22400":s==="Medium"?"#B85C00":"#1D7A45";
const lvlColor   = (l: string) => l==="High"?"#2F27CE":l==="Medium"?"#B85C00":"#6B6A80";
const catBadgeColor: Record<string,string> = {
  "E-commerce":"#FC2F00","SaaS":"#2F27CE","Service":"#1D7A45","Corporate":"#B85C00","Content":"#6B6A80",
};

function emailShell(r: Record<string, any>, body: string): string {
  const cat = r.detectedCategory || "Website";
  const badgeColor = catBadgeColor[cat] || "#2F27CE";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Merriweather+Sans:wght@400;600;700;800&family=Inter:wght@400;500&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background:#F4F3FF;font-family:'Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3FF;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#0D0A48;border-radius:12px 12px 0 0;padding:32px 40px 28px;">
  <div style="font-family:'Merriweather Sans',sans-serif;font-weight:800;font-size:20px;color:#fff;margin-bottom:4px;">Creative<span style="color:#FF9070;">Bridge</span> <span style="color:#6B6A80;font-weight:400;">/</span> <span style="color:#9998B0;font-weight:500;font-size:15px;">Audit</span></div>
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(47,39,206,0.3);">
    <span style="background:${badgeColor};color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:3px 12px;border-radius:100px;">${cat} Audit</span>
    <span style="font-family:'Merriweather Sans',sans-serif;font-size:10px;color:#555;letter-spacing:1px;text-transform:uppercase;margin-left:10px;">${r.reportType||""}</span>
  </div>
  <div style="margin-top:12px;">
    <div style="font-size:13px;color:#9998B0;">Website: <a href="${r.websiteUrl||""}" style="color:#B8B4FF;">${r.websiteUrl||""}</a></div>
    <div style="font-size:13px;color:#9998B0;margin-top:3px;">Company: <span style="color:#fff;">${r.companyName||""}</span></div>
    <div style="font-size:13px;color:#9998B0;margin-top:3px;">Date: ${r.auditDate||""}</div>
  </div>
</td></tr>
<tr><td style="background:#fff;padding:0 40px 40px;">${body}</td></tr>
<tr><td style="background:#0D0A48;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
  <div style="font-size:12px;color:#6B6A80;">Creative Bridge · AI-powered UX audits · <a href="mailto:hello@creativebridge.co.za" style="color:#8078FF;text-decoration:none;">hello@creativebridge.co.za</a></div>
  <div style="font-size:11px;color:#3D3C55;margin-top:4px;">audit.creativebridge.co.za</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

function buildFreeEmail(r: Record<string, any>): string {
  const catRows = (r.categoryScores||[]).map((c: any) => `
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#3D3C55;border-bottom:1px solid #E8E7F5;">${c.category||""}</td>
      <td style="padding:12px 16px;text-align:center;border-bottom:1px solid #E8E7F5;"><span style="font-family:'Merriweather Sans',sans-serif;font-weight:800;font-size:16px;color:${scoreColor(c.score||0)};">${c.score||0}</span><span style="font-size:11px;color:#9998B0;">/10</span></td>
      <td style="padding:12px 16px;font-size:12px;color:#6B6A80;border-bottom:1px solid #E8E7F5;">${c.summary||""}</td>
    </tr>`).join("");
  const strengthCards = (r.strengths||[]).map((s: any) => `
    <div style="background:#EAFAF1;border:1px solid #B7E4C7;border-radius:8px;padding:14px 16px;margin-bottom:10px;">
      <div style="font-weight:700;font-size:13px;color:#1D7A45;margin-bottom:4px;">✓ ${s.title||""}</div>
      <div style="font-size:13px;color:#3D3C55;">${s.description||""}</div>
    </div>`).join("");
  const issueCards = (r.issues||[]).map((i: any) => `
    <div style="background:#FFF8E1;border:1px solid #F5C98A;border-radius:8px;padding:14px 16px;margin-bottom:10px;">
      <div style="margin-bottom:6px;"><span style="font-weight:700;font-size:13px;color:#232225;">${i.title||""}</span>
        <span style="background:${sevColor(i.severity||"Medium")};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:100px;margin-left:8px;">${i.severity||"Medium"}</span>
      </div>
      <div style="font-size:13px;color:#3D3C55;margin-bottom:4px;">${i.description||""}</div>
      <div style="font-size:12px;color:#6B6A80;font-style:italic;">Impact: ${i.impact||""}</div>
    </div>`).join("");
  const qwRows = (r.quickWins||[]).map((q: any) => `
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#3D3C55;border-bottom:1px solid #E8E7F5;">${q.recommendation||""}</td>
      <td style="padding:12px 16px;text-align:center;border-bottom:1px solid #E8E7F5;"><span style="color:${lvlColor(q.effort||"")};font-weight:600;font-size:12px;">${q.effort||""}</span></td>
      <td style="padding:12px 16px;text-align:center;border-bottom:1px solid #E8E7F5;"><span style="color:${lvlColor(q.impact||"")};font-weight:600;font-size:12px;">${q.impact||""}</span></td>
    </tr>`).join("");
  return emailShell(r, `
    <div style="text-align:center;padding:36px 0 28px;border-bottom:1px solid #E8E7F5;">
      <div style="width:96px;height:96px;border-radius:50%;border:4px solid ${scoreColor(r.overallScore?.score||0,100)};display:inline-flex;align-items:center;justify-content:center;flex-direction:column;margin-bottom:16px;">
        <div style="font-family:'Merriweather Sans',sans-serif;font-size:30px;font-weight:800;color:#0D0A48;line-height:1;">${r.overallScore?.score||0}</div>
        <div style="font-size:11px;color:#9998B0;">/ 100</div>
      </div>
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:18px;font-weight:700;color:#0D0A48;margin-bottom:8px;">${r.overallScore?.rating||""}</div>
      <div style="font-size:14px;color:#6B6A80;line-height:1.7;max-width:440px;margin:0 auto;">${r.overallScore?.summary||""}</div>
    </div>
    <div style="padding:28px 0 0;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:16px;">Category Snapshot</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E7F5;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#F4F3FF;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#6B6A80;letter-spacing:1px;text-transform:uppercase;">Category</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#6B6A80;letter-spacing:1px;text-transform:uppercase;">Score</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#6B6A80;letter-spacing:1px;text-transform:uppercase;">Summary</th>
        </tr></thead><tbody>${catRows}</tbody>
      </table>
    </div>
    <div style="padding:28px 0 0;"><div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:16px;">Key Strengths</div>${strengthCards}</div>
    <div style="padding:28px 0 0;"><div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:16px;">Main UX Issues</div>${issueCards}</div>
    <div style="padding:28px 0 0;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:16px;">Top Quick Wins</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E7F5;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#F4F3FF;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#6B6A80;letter-spacing:1px;text-transform:uppercase;">Recommendation</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#6B6A80;letter-spacing:1px;text-transform:uppercase;">Effort</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#6B6A80;letter-spacing:1px;text-transform:uppercase;">Impact</th>
        </tr></thead><tbody>${qwRows}</tbody>
      </table>
    </div>
    <div style="margin-top:32px;background:#EEEEFF;border:1.5px solid #B8B4FF;border-radius:12px;padding:28px;text-align:center;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:18px;font-weight:800;color:#0D0A48;margin-bottom:8px;">${r.upgradePrompt?.headline||"Unlock the full UX report"}</div>
      <div style="font-size:13px;color:#6B6A80;line-height:1.7;margin-bottom:20px;">${r.upgradePrompt?.description||""}</div>
      <a href="https://audit.creativebridge.co.za" style="display:inline-block;background:#FC2F00;color:#fff;font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;text-decoration:none;">${r.upgradePrompt?.cta||"Upgrade to Pro Audit"} →</a>
    </div>`);
}

function buildProEmail(r: Record<string, any>): string {
  const catCards = (r.categoryScores||[]).map((c: any) => `
    <div style="background:#F4F3FF;border:1px solid #DDDBFF;border-radius:8px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-family:'Merriweather Sans',sans-serif;font-weight:700;font-size:14px;color:#0D0A48;">${c.category||""}</span>
        <span style="font-family:'Merriweather Sans',sans-serif;font-weight:800;font-size:18px;color:${scoreColor(c.score||0)};">${c.score||0}<span style="font-size:12px;color:#9998B0;">/10</span></span>
      </div>
      <div style="font-size:13px;color:#3D3C55;margin-bottom:8px;line-height:1.6;">${c.keyObservations||""}</div>
      <span style="background:${sevColor(c.priority||"Medium")};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:100px;">${c.priority||"Medium"} Priority</span>
    </div>`).join("");
  const issueList = (r.top5Issues||[]).map((i: string) => `
    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #E8E7F5;">
      <span style="color:#C22400;font-weight:700;flex-shrink:0;">!</span>
      <span style="font-size:13px;color:#3D3C55;">${i}</span>
    </div>`).join("");
  const winList = (r.top5QuickWins||[]).map((w: string) => `
    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #E8E7F5;">
      <span style="color:#1D7A45;font-weight:700;flex-shrink:0;">✓</span>
      <span style="font-size:13px;color:#3D3C55;">${w}</span>
    </div>`).join("");
  const roadmapSec = (title: string, items: string[], color: string) =>
    `<div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${color};margin-bottom:8px;">${title}</div>
      ${(items||[]).map(i => `<div style="font-size:13px;color:#3D3C55;padding:6px 0;border-bottom:1px solid #E8E7F5;">→ ${i}</div>`).join("")}
    </div>`;
  return emailShell(r, `
    <div style="text-align:center;padding:36px 0 28px;border-bottom:1px solid #E8E7F5;">
      <div style="width:96px;height:96px;border-radius:50%;border:4px solid ${scoreColor(r.overallScore?.score||0,100)};display:inline-flex;align-items:center;justify-content:center;flex-direction:column;margin-bottom:16px;">
        <div style="font-family:'Merriweather Sans',sans-serif;font-size:30px;font-weight:800;color:#0D0A48;line-height:1;">${r.overallScore?.score||0}</div>
        <div style="font-size:11px;color:#9998B0;">/ 100</div>
      </div>
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:18px;font-weight:700;color:#0D0A48;margin-bottom:8px;">${r.overallScore?.rating||""}</div>
      <div style="font-size:14px;color:#6B6A80;line-height:1.7;max-width:440px;margin:0 auto;">${r.overallScore?.summary||""}</div>
    </div>
    <div style="padding:28px 0;border-bottom:1px solid #E8E7F5;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:12px;">Executive Summary</div>
      <div style="font-size:14px;color:#3D3C55;line-height:1.75;background:#F4F3FF;border-left:3px solid #2F27CE;padding:16px;border-radius:0 8px 8px 0;">${r.executiveSummary||""}</div>
    </div>
    <div style="padding:28px 0 0;"><div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:16px;">10-Category Breakdown</div>${catCards}</div>
    <div style="padding:28px 0 0;"><div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:12px;">Top 5 UX Issues</div>${issueList}</div>
    <div style="padding:28px 0 0;"><div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:12px;">Top 5 Quick Wins</div>${winList}</div>
    <div style="padding:28px 0 0;">
      <div style="font-family:'Merriweather Sans',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2F27CE;margin-bottom:16px;">Phased Improvement Roadmap</div>
      <div style="background:#F4F3FF;border:1px solid #DDDBFF;border-radius:8px;padding:20px;">
        ${roadmapSec("Immediate — This Week", r.phasedRoadmap?.immediate||[], "#C22400")}
        ${roadmapSec("30-Day Plan", r.phasedRoadmap?.thirtyDay||[], "#B85C00")}
        ${roadmapSec("Long Term (60-90 Days)", r.phasedRoadmap?.longTerm||[], "#1D7A45")}
      </div>
    </div>`);
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: "Creative Bridge Audit <audit@creativebridge.co.za>", to: [to], subject, html }),
  });
  const data = await res.json();
  console.log("Resend:", JSON.stringify(data));
  return data;
}

async function processAudit(form: Record<string, string>, submissionId: string) {
  const tier = form.tier === "pro" ? "pro" : "free";
  try {
    const prompt = buildPrompt(form, tier);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: tier === "pro" ? 3000 : 2000,
        system: "You are a senior UX consultant. Return ONLY raw JSON. Do NOT wrap in markdown backticks. Do NOT add any text before or after the JSON object.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    console.log("Claude raw:", JSON.stringify(data).substring(0, 400));
    const text = data.content?.[0]?.text ?? "{}";
    const report = parseJSON(text);

    const html = tier === "pro" ? buildProEmail(report) : buildFreeEmail(report);
    const subject = `Your ${(report as any).detectedCategory || ""} UX Audit — ${form.companyName}`;
    await sendEmail(form.email, subject, html);

    await supabase.from("audit_submissions")
      .update({ status: "complete", result: report, email_sent: true, email_sent_at: new Date().toISOString() })
      .eq("id", submissionId);

    console.log("Audit complete for", submissionId);
  } catch (err) {
    console.error("processAudit error:", err);
    await supabase.from("audit_submissions")
      .update({ status: "error" })
      .eq("id", submissionId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const form = await req.json();
    const tier = form.tier === "pro" ? "pro" : "free";

    // Save submission immediately
    const { data: submission } = await supabase.from("audit_submissions").insert({
      website_url: form.websiteUrl, company_name: form.companyName,
      main_goal: form.mainGoal, target_user: form.targetUser,
      user_action: form.userAction, concerns: form.concerns, email: form.email,
      tier, prompt_version: "v3.1", status: "processing", created_at: new Date().toISOString(),
    }).select().single();

    const submissionId = submission?.id;

    // Use EdgeRuntime.waitUntil to process in background after response is sent
    // This bypasses the wall-clock timeout on free tier
    (globalThis as any).EdgeRuntime?.waitUntil(processAudit(form, submissionId));

    // Return immediately — don't wait for Claude
    return new Response(JSON.stringify({
      success: true,
      message: "Audit is being processed. Check your email in 1-2 minutes.",
      submissionId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
