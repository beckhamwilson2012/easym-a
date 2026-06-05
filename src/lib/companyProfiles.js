// Curated qualitative company profiles for the deck's "Company Profiles" slide (reference §3).
// The free data stack (SEC EDGAR fundamentals + Yahoo/Finnhub prices) does NOT provide
// qualitative attributes (CEO, HQ, founded year, headcount, GTM, product list), so these are
// hand-curated from public company disclosures and labeled as such on the slide — never
// presented as fetched data. Verify against the latest 10-K/annual report before relying on them.
//
// `asOf` is the approximate date these were last checked. Unknown tickers fall back to PROFILE_NA.

export const COMPANY_PROFILES = {
  CRM: {
    name: 'Salesforce, Inc.',
    founded: '1999',
    ceo: 'Marc Benioff (Chair & CEO)',
    hq: 'San Francisco, California, USA',
    employees: '~76,000',
    business: 'Cloud-based CRM and enterprise software — sales, service, marketing, commerce, analytics, and the Agentforce AI platform.',
    customers: 'Enterprise and mid-market across virtually every industry; >150,000 customers globally.',
    gtm: 'Direct enterprise sales force complemented by a large ISV/SI partner ecosystem (AppExchange) and industry clouds.',
    products: 'Sales Cloud, Service Cloud, Marketing Cloud, Data Cloud, Slack, Tableau, MuleSoft, Agentforce',
  },
  TEAM: {
    name: 'Atlassian Corporation',
    founded: '2002',
    ceo: 'Mike Cannon-Brookes (CEO)',
    hq: 'Sydney, Australia (co-HQ San Francisco, USA)',
    employees: '~12,000',
    business: 'Team collaboration and software-development tooling for planning, tracking, and shipping work.',
    customers: 'Software, IT, and business teams; >300,000 customers, historically strong in developer and SMB segments moving upmarket.',
    gtm: 'Low-touch, self-serve and product-led growth with a channel/solution-partner network; minimal traditional field sales.',
    products: 'Jira, Confluence, Jira Service Management, Trello, Bitbucket, Loom, Compass',
  },
};

export const PROFILE_NA = {
  founded: '—',
  ceo: '—',
  hq: '—',
  employees: '—',
  business: 'Qualitative profile not available on the free data stack — see latest 10-K / annual report.',
  customers: '—',
  gtm: '—',
  products: '—',
};

export const PROFILES_AS_OF = 'June 2026';

// Returns a curated profile by ticker (case-insensitive), or a clearly-marked N/A profile.
export function getCompanyProfile(ticker, fallbackName) {
  const key = (ticker || '').toUpperCase();
  if (COMPANY_PROFILES[key]) return { ...COMPANY_PROFILES[key], curated: true };
  return { ...PROFILE_NA, name: fallbackName || key || '—', curated: false };
}
