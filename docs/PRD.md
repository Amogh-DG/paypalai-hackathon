# Leash: spending mandates for AI shopping agents

PayPal AI Hackathon project. Deadline: Nov 12, 2026, 12:00 pm Pacific (Nov 13, 1:30 am IST). Treat Nov 11 as the real deadline.

## One-line pitch

An AI shopping agent can only spend money inside a signed set of rules. Every purchase it proposes is checked by a separate policy engine before PayPal is allowed to capture the payment.

## Problem

People will not let AI agents spend their money because agents can be tricked (prompt injection), make mistakes, or overspend. Leash is the safety layer between an agent and a payment.

## Users

- A person who wants an agent to buy things for them within limits (gifts, supplies, groceries).
- A parent, team or company that wants to delegate purchases with hard limits and a full audit trail.

## Core principle

The agent is untrusted. It never touches PayPal and cannot edit the mandate. It can only submit a proposal. Only the policy engine and payment service can move money.

## Demo story (the video follows this)

1. User creates a mandate: gifts, total budget 80 USD, ask me above 50 USD, allowed merchants and categories, fixed shipping address.
2. User chats: "Find a birthday gift for my dad who likes hiking, under 50." Agent searches products, proposes a purchase, policy says allow, PayPal authorizes and captures. Audit log shows it.
3. User asks for something above 50 USD. Policy says ask, an approval popup appears, user approves, payment goes through.
4. Attack: the agent visits a shady product page with hidden instructions to buy 10 units and ship elsewhere. The agent is tricked and proposes it. Policy blocks it with clear reasons, PayPal is never charged, the audit log shows the blocked attempt.

## Scope

In scope: mandate creation and signing, agent with tool calling, product search, policy engine, PayPal sandbox order flow (create, authorize, capture or void), approval flow, audit log with AG Grid, mock PayPal mode, hosted demo.

Out of scope: real money, user accounts and login, multiple mandates per user, real shipping, mobile app.

## Stack (fixed, do not debate)

- Language: TypeScript everywhere.
- Server: Node 20, Express, zod, better-sqlite3, vitest.
- Web: React, Vite, ag-grid-react.
- LLM: Gemini by default through an adapter, selected with LLM_PROVIDER env var, swappable.
- Products: Channel3 search behind a ProductSearch interface, with a local fake catalog fallback.
- PayPal: Orders v2 REST API in sandbox. PAYPAL_MODE=mock or sandbox.
- Hosting: Render.
- License: MIT.

## Repository layout

- server/ : API, policy engine, PayPal layer, agent, product search
- web/ : React app
- shared/types.ts : types used by both (copied verbatim from API_CONTRACT.md)
- docs/ : PRD.md, API_CONTRACT.md, ROLE_A_MONEY_PATH.md, ROLE_B_AI_PATH.md
- README.md, LICENSE

## Functional requirements

FR1. User can create and view a mandate. The server signs it with HMAC so it cannot be altered by the agent.
FR2. User can chat with a shopping agent.
FR3. Agent has these tools only: get_mandate_summary, search_products, fetch_page, submit_proposal. It has no payment tools.
FR4. Every proposal runs through the policy engine and returns allow, ask or block with per-rule reasons.
FR5. allow: payment flow starts automatically. ask: waits for user approve or reject. block: stops, nothing sent to PayPal.
FR6. Payment flow: create order with intent AUTHORIZE, buyer approves in PayPal, server authorizes, re-checks amount and policy, then captures or voids.
FR7. Every step writes an audit entry. Audit page shows all entries in an AG Grid table with filters and sorting.
FR8. Webhooks update payment status (authorization created, capture completed, authorization voided).
FR9. Mock mode runs the whole flow with no PayPal credentials.
FR10. Fake shady merchant page exists for the injection demo.

## Policy rules

signature_valid, not_expired, currency_match, merchant_allowed, category_allowed, per_item_cap, max_quantity, ship_to_matches, within_budget (block severity). approval_threshold (ask severity). Any block wins over ask.

## Non-functional

- Anyone can run it locally from README in under 10 minutes using mock mode.
- Policy engine is a pure function with unit tests.
- No secrets in the repository. .env.example lists all variables.
- English only for all submission material.

## Submission checklist (Devpost)

- Public code repository with MIT license visible in the About section.
- Text description of features and functionality.
- Tools used: list the LLM, PayPal APIs, Channel3, AG Grid, Render, and explain how each is used.
- Working demo: hosted URL and also README run instructions with mock mode and sandbox mode.
- Demo video under 3 minutes, public on YouTube, no copyrighted music or third-party logos.
- Statement that the project was built during the submission period.

## Prize targets

Grand prizes, Best Use of Agentic Commerce, Best Use of PayPal + AI, Most Impactful, Best Use of Channel3, Best Use of AG Grid, Best Use of Render. One project can win one Grand or Honorable prize plus one sponsor prize.

## Cut order if behind schedule

1. Webhooks (keep return-URL flow).
2. Approval popup polish.
3. Real Channel3 (use fake catalog).
Never cut: the blocked-attack demo and the audit log.
