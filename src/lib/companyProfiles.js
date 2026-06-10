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
  MSFT: {
    name: 'Microsoft Corporation',
    founded: '1975',
    ceo: 'Satya Nadella (Chair & CEO)',
    hq: 'Redmond, Washington, USA',
    employees: '~228,000',
    business: 'Cloud computing (Azure), productivity software (Microsoft 365), Windows, gaming (Xbox), LinkedIn, and AI (Copilot).',
    customers: 'Consumers, developers, and enterprises across every industry and government; billions of users worldwide.',
    gtm: 'Hybrid: enterprise field sales and a large partner/ISV channel plus self-serve consumer and SMB motions.',
    products: 'Azure, Microsoft 365, Windows, Dynamics 365, Teams, GitHub, LinkedIn, Xbox, Copilot',
  },
  ADBE: {
    name: 'Adobe Inc.',
    founded: '1982',
    ceo: 'Shantanu Narayen (Chair & CEO)',
    hq: 'San Jose, California, USA',
    employees: '~30,000',
    business: 'Digital media creativity and document software, plus a digital experience (marketing) cloud.',
    customers: 'Creative professionals, enterprises, SMBs, and individuals across media and marketing worldwide.',
    gtm: 'Subscription (SaaS) via direct, web self-serve, and partner channels; enterprise license agreements for large accounts.',
    products: 'Creative Cloud (Photoshop, Illustrator, Premiere), Document Cloud (Acrobat), Experience Cloud, Firefly',
  },
  NOW: {
    name: 'ServiceNow, Inc.',
    founded: '2004',
    ceo: 'Bill McDermott (Chair & CEO)',
    hq: 'Santa Clara, California, USA',
    employees: '~26,000',
    business: 'Cloud digital-workflow automation platform (the Now Platform) for IT, employee, customer, and AI workflows.',
    customers: 'Large enterprises and government; ~8,400 customers including a majority of the Fortune 500.',
    gtm: 'Direct enterprise sales with a global SI/consulting partner ecosystem.',
    products: 'Now Platform, ITSM, ITOM, HR Service Delivery, Customer Service Management, Security Operations, Now Assist (AI)',
  },
  GOOGL: {
    name: 'Alphabet Inc.',
    founded: '1998 (Google); 2015 (Alphabet)',
    ceo: 'Sundar Pichai (CEO)',
    hq: 'Mountain View, California, USA',
    employees: '~183,000',
    business: 'Internet search and advertising (Google), YouTube, cloud (Google Cloud), Android, and AI (Gemini / DeepMind).',
    customers: 'Billions of consumers, advertisers of all sizes, and enterprise cloud customers worldwide.',
    gtm: 'Self-serve advertising at scale, enterprise cloud field sales, and a broad consumer-device ecosystem.',
    products: 'Google Search, YouTube, Google Cloud, Android, Chrome, Workspace, Gemini, Pixel',
  },
  HUBS: {
    name: 'HubSpot, Inc.',
    founded: '2006',
    ceo: 'Yamini Rangan (CEO)',
    hq: 'Cambridge, Massachusetts, USA',
    employees: '~8,000',
    business: 'Cloud customer platform (CRM) spanning marketing, sales, service, content, and operations for scaling businesses.',
    customers: 'SMB and mid-market companies; ~250,000 customers across 130+ countries.',
    gtm: 'Inbound, product-led and freemium funnel complemented by inside sales and a solutions-partner network.',
    products: 'Marketing Hub, Sales Hub, Service Hub, Content Hub, Operations Hub, Smart CRM, Breeze (AI)',
  },
  ORCL: {
    name: 'Oracle Corporation',
    founded: '1977',
    ceo: 'Safra Catz (CEO)',
    hq: 'Austin, Texas, USA',
    employees: '~160,000',
    business: 'Enterprise database, cloud infrastructure (OCI), and applications (Fusion ERP/HCM, NetSuite).',
    customers: 'Large enterprises and government across all industries worldwide.',
    gtm: 'Direct enterprise sales plus partner ecosystem; cloud-consumption and license/support models.',
    products: 'Oracle Database, OCI, Fusion ERP/HCM, NetSuite, Oracle Health (Cerner), MySQL',
  },
  SAP: {
    name: 'SAP SE',
    founded: '1972',
    ceo: 'Christian Klein (CEO)',
    hq: 'Walldorf, Germany',
    employees: '~108,000',
    business: 'Enterprise application software — ERP (S/4HANA), business cloud, spend management, and analytics.',
    customers: 'Large enterprises and SMBs across virtually every industry globally.',
    gtm: 'Direct enterprise sales and a large SI/partner ecosystem; cloud-subscription transition.',
    products: 'S/4HANA, Business Technology Platform, Ariba, SuccessFactors, Concur, Analytics Cloud',
  },
  INTU: {
    name: 'Intuit Inc.',
    founded: '1983',
    ceo: 'Sasan Goodarzi (CEO)',
    hq: 'Mountain View, California, USA',
    employees: '~18,000',
    business: 'Financial-technology software for consumers and small businesses — tax, accounting, marketing, and personal finance.',
    customers: 'Consumers, small businesses, and accountants; 100M+ customers.',
    gtm: 'Self-serve and product-led with seasonal marketing; accountant channel and SMB ecosystem.',
    products: 'TurboTax, QuickBooks, Credit Karma, Mailchimp',
  },
  SNOW: {
    name: 'Snowflake Inc.',
    founded: '2012',
    ceo: 'Sridhar Ramaswamy (CEO)',
    hq: 'Bozeman, Montana, USA',
    employees: '~7,800',
    business: 'Cloud data platform (warehousing, lakes, sharing, and AI) delivered as a consumption-based service.',
    customers: 'Enterprises and data-driven organizations; ~10,000 customers including many of the Forbes Global 2000.',
    gtm: 'Consumption-based; direct enterprise sales plus cloud-marketplace and SI partners.',
    products: 'Snowflake Data Cloud, Snowpark, Cortex AI, Native Apps, data sharing/marketplace',
  },
  WDAY: {
    name: 'Workday, Inc.',
    founded: '2005',
    ceo: 'Carl Eschenbach (CEO)',
    hq: 'Pleasanton, California, USA',
    employees: '~19,000',
    business: 'Cloud enterprise applications for human capital management (HCM) and financial management.',
    customers: 'Large and mid-market enterprises; ~11,000 customers including ~60% of the Fortune 500.',
    gtm: 'Direct enterprise sales with a SI/consulting partner ecosystem; subscription model.',
    products: 'Workday HCM, Financial Management, Adaptive Planning, Prism Analytics, Workday AI',
  },
  MNDY: {
    name: 'monday.com Ltd.',
    founded: '2012',
    ceo: 'Roy Mann & Eran Zinman (Co-CEOs)',
    hq: 'Tel Aviv, Israel',
    employees: '~2,500',
    business: 'Cloud Work OS platform for project/work management, CRM, and software-development workflows.',
    customers: 'SMB to enterprise teams; ~245,000 customers across 200+ industries.',
    gtm: 'Product-led growth and self-serve funnel complemented by inside sales and channel partners.',
    products: 'monday work management, monday CRM, monday dev, Work OS platform',
  },
  AMZN: {
    name: 'Amazon.com, Inc.',
    founded: '1994',
    ceo: 'Andy Jassy (President & CEO)',
    hq: 'Seattle, Washington, USA',
    employees: '~1,550,000',
    business: 'E-commerce marketplace, cloud computing (AWS), advertising, devices, and subscriptions (Prime).',
    customers: 'Hundreds of millions of consumers and millions of sellers and AWS enterprise customers worldwide.',
    gtm: 'Consumer self-serve marketplace, third-party seller ecosystem, and AWS enterprise/partner sales.',
    products: 'Amazon.com marketplace, AWS, Prime, Advertising, Alexa / Devices, Kuiper',
  },
  META: {
    name: 'Meta Platforms, Inc.',
    founded: '2004',
    ceo: 'Mark Zuckerberg (Chair & CEO)',
    hq: 'Menlo Park, California, USA',
    employees: '~74,000',
    business: 'Social media and digital advertising (Facebook, Instagram, WhatsApp) plus metaverse and AI (Reality Labs).',
    customers: 'Billions of users and millions of advertisers globally.',
    gtm: 'Self-serve advertising at massive scale plus enterprise and agency sales.',
    products: 'Facebook, Instagram, WhatsApp, Messenger, Threads, Quest, Llama (AI)',
  },
  NVDA: {
    name: 'NVIDIA Corporation',
    founded: '1993',
    ceo: 'Jensen Huang (Founder, President & CEO)',
    hq: 'Santa Clara, California, USA',
    employees: '~30,000',
    business: 'Accelerated computing — GPUs and full-stack platforms for AI / data center, gaming, pro visualization, and automotive.',
    customers: 'Cloud providers, enterprises, researchers, gamers, and OEMs worldwide.',
    gtm: 'OEM/ODM and channel distribution, hyperscaler partnerships, and direct data-center sales.',
    products: 'GeForce / RTX, data-center GPUs (Hopper, Blackwell), CUDA, DGX, Omniverse, DRIVE',
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

// Returns a curated profile by ticker (case-insensitive). For non-curated tickers, falls back to the
// fetched SIC industry description for the Business row (so a company is never FULLY blank), with the
// remaining qualitative fields honestly marked "—". `fallback` is the company object (uses its
// sicDescription); pass it from the deck so the fallback can populate.
export function getCompanyProfile(ticker, fallbackName, fallback = {}) {
  const key = (ticker || '').toUpperCase();
  if (COMPANY_PROFILES[key]) return { ...COMPANY_PROFILES[key], curated: true };
  const sic = fallback && fallback.sicDescription;
  return {
    ...PROFILE_NA,
    name: fallbackName || key || '—',
    business: sic
      ? `${sic} (industry classification per SEC filing). Detailed qualitative profile not curated — see latest 10-K / annual report.`
      : PROFILE_NA.business,
    curated: false,
  };
}
