# Solo-founder strategy and product rationale

## Recommended path

Primary business model:
1. Start with **vertical AI workflow services** for SMBs and local-service merchants.
2. Productize the most reusable wedge into **Compliance Radar**, a lightweight ad-copy and contract risk scanner.

This combination is strong for a solo founder because:
- services generate cash fast,
- the scanner creates a repeatable product layer,
- compliance pain is easy to explain in one sentence,
- the MVP has low integration complexity compared with customer-service automation or multi-platform commerce systems.

## Why this product instead of the other ideas

### Better than generic AI customer service
Generic AI customer service is attractive, but it is now crowded by large platforms and incumbent support vendors. It also requires deep systems integration, fulfillment logic, and operational uptime.

### Better than pure AI BI assistant
BI copilots are increasingly embedded in major analytics suites. Winning there usually requires proprietary data access, strong semantic modeling, and a longer enterprise sales cycle.

### Better than personal knowledge base
Personal knowledge tools are promising but highly crowded and difficult to monetize cheaply in the short term without a strong distribution edge.

### Better than e-commerce data selection first
Commerce selection tools can work, but reliable data access, permissions, and ongoing source maintenance increase technical and commercial complexity for a solo founder.

## Commercial packaging

### Package A: AI workflow service
- Setup fee: bespoke workflow build
- Monthly fee: support, iteration, prompt tuning, reporting
- Target niches: dental clinics, beauty chains, HR boutiques, law firms, local education providers

### Package B: Compliance Radar
- Lite: single-user document and ad scan
- Pro: team workspace, review history, export, rule customization
- Agency mode: use the scanner inside a service engagement as a differentiator

## Product architecture

Client -> FastAPI application -> parsing layer -> deterministic rule engine -> optional OpenAI-compatible LLM -> scoring and recommendations -> SQLite or external DB-backed job history -> browser UI or API clients

## Roadmap

### Week 1
- Launch MVP
- Use with 3 design partners
- Collect 20+ real ad-copy and contract samples

### Week 2-3
- Add vertical-specific rule packs
- Add exportable PDF/HTML report
- Add reviewer notes and approval workflow

### Month 2
- Add user accounts and multi-tenant storage
- Add webhook integrations (Feishu / email / CRM)
- Add industry packs: medical beauty, education, local retail, livestream commerce
