// Curated customer-count & net-retention metrics — SaaS companies that DISCLOSE them.
//
// These are BUSINESS metrics (10-K MD&A / 20-F / earnings shareholder letters), NOT XBRL financial facts,
// so there is NO auto-fetch and NO arithmetic tie-out. A scraper was correctly abandoned (the Stage-1
// investigation found 4 companies use 4 different metric names, and Salesforce reports ATTRITION — the
// inverse of retention — not NRR). This is the honest path: each figure is hand-verified to its source
// filing, carries its OWN definition and as-of period, and is NOT cross-comparable across issuers.
//
// Discipline: NEVER invent. If a figure can't be verified to a filing, it is `null` (caller renders "not
// disclosed"). Salesforce's attrition is flagged `isAttrition` and labeled "NOT retention" — never dressed
// as NRR (the sign-flipped lie). Non-SaaS issuers are simply absent → the caller omits the block.
//
// Sources verified in the customer/NRR Stage-1 filing investigation.

export const CUSTOMER_METRICS = {
  TEAM: {
    name: 'Atlassian',
    customerCount: '51,978',
    customerCountBasis: 'customers with >$10K Cloud ARR (total base >300,000)',
    customerCountAsOf: 'FY2025 (Jun 30, 2025)',
    customerCountSource: '10-K, filed 2025-08-15 (acc. 0001650372-25-000036)',
    isAttrition: false,
    retentionMetric: 'Net Revenue Retention (cloud)',
    retentionValue: '~120%',
    retentionDefinition: 'cloud, MRR-based, point-in-time; existing-customer expansion net of contraction & churn, excludes new customers',
    retentionAsOf: 'Q4 FY2025 (end Jun 2025)',
    retentionSource: 'Q4 FY2025 shareholder letter (earnings 8-K exhibit, filed 2025-08-07)',
  },
  HUBS: {
    name: 'HubSpot',
    customerCount: '288,706',
    customerCountBasis: 'total Customers (business entities with ≥1 paid subscription)',
    customerCountAsOf: 'Dec 31, 2025',
    customerCountSource: '10-K, filed 2026-02-11 (acc. 0001193125-26-046646)',
    isAttrition: false,
    retentionMetric: 'Net Revenue Retention',
    retentionValue: '103.5%',
    retentionDefinition: 'monthly cohort, annualized; recomputed under a revised 2025 methodology (prior basis 102.2% for FY2024)',
    retentionAsOf: 'FY2025',
    retentionSource: '10-K MD&A, filed 2026-02-11',
  },
  MNDY: {
    name: 'monday.com',
    customerCount: '>250,000',
    customerCountBasis: 'paid customers (unique paid web-domain accounts); 4,281 with >$50K ARR',
    customerCountAsOf: 'Dec 31, 2025',
    customerCountSource: '20-F, filed 2026-03-13 (acc. 0001178913-26-000870)',
    isAttrition: false,
    retentionMetric: 'Net Dollar Retention',
    retentionValue: '110% (116% for the >$50K-ARR cohort)',
    retentionDefinition: 'ARR-based, trailing-12-month weighted; multiple cohort figures published (overall 110%, >$50K 116%, >$100K 116%)',
    retentionAsOf: 'Q4 FY2025 (Dec 31, 2025)',
    retentionSource: '20-F, filed 2026-03-13',
  },
  CRM: {
    name: 'Salesforce',
    customerCount: null,                 // Salesforce does NOT disclose a total customer count (qualitative only)
    customerCountBasis: null,
    customerCountAsOf: null,
    customerCountSource: null,
    isAttrition: true,                   // reports ATTRITION, not retention — the inversion, labeled explicitly
    retentionMetric: 'Attrition rate (NOT retention)',
    retentionValue: '~8%',
    retentionDefinition: 'annualized-contract-value LOST, trailing-12-month (the INVERSE of net retention; excludes Slack self-service & current-year acquisitions) — this is not a net-revenue-retention figure',
    retentionAsOf: 'FY2026 (Jan 31, 2026)',
    retentionSource: '10-K MD&A, filed 2026-03-02 (acc. 0001108524-26-000060)',
  },
};

export const getCustomerMetrics = (ticker) => CUSTOMER_METRICS[(ticker || '').toUpperCase()] || null;
