import type { CollectionDefinition, CollectionField, StartPage } from '../../webAutomation/collection';
import type { PlatformSignal, SitePatternDefinition } from '../../webAutomation/sitePatterns';
import type { MockPage, MockSite } from './mockHost';
import type { MockApiIntegration } from './integration';

export const ATS_ORIGIN = 'https://boards.mock-ats.test';
export const OTHER_ATS_ORIGIN = 'https://jobs.other-ats.test';
export const UNKNOWN_ORIGIN = 'https://jobs.unknown.test';

interface MockJob {
  slug: string;
  title: string;
  location: string;
  description: string;
}

function job(slug: string, title: string, skills: string): MockJob {
  return {
    slug,
    title,
    location: 'Remote',
    description: `We are hiring a ${title}. You will build reliable systems using ${skills}. Collaborate with product and design.`,
  };
}

/** One company's board on a mock ATS: listing pages plus one detail page per job, all with the same markup. */
export function atsCompany(company: string, displayName: string, pages: MockJob[][], options: { challenge?: boolean; restoresOnBack?: boolean; jobPageWall?: boolean } = {}): Record<string, MockPage> {
  const result: Record<string, MockPage> = {};
  pages.forEach((jobs, index) => {
    const path = index === 0 ? `/${company}/jobs` : `/${company}/jobs?page=${index + 1}`;
    result[path] = {
      challenge: index === 0 ? options.challenge : undefined,
      restoresOnBack: options.restoresOnBack,
      ...(index < pages.length - 1 ? { nextPage: `/${company}/jobs?page=${index + 2}` } : {}),
      matches: {
        'ats-listing': {
          confidence: 0.93,
          records: jobs.map((item) => ({ ref: `${company}-${item.slug}`, values: { title: item.title, link: `/${company}/jobs/${item.slug}?utm_source=board` } })),
        },
      },
    };
    for (const item of jobs) {
      result[`/${company}/jobs/${item.slug}`] = {
        ...(options.jobPageWall ? { wall: true } : {}),
        matches: {
          'ats-detail': {
            confidence: 0.9,
            records: [{ ref: `${company}-${item.slug}-detail`, values: { title: item.title, company: displayName, location: item.location, description: item.description } }],
          },
        },
      };
    }
  });
  return result;
}

export const atsListingPattern: SitePatternDefinition = {
  id: 'ats-listing',
  name: 'Mock ATS job board',
  role: 'listing',
  appliesTo: [{ target: 'page', host: 'boards.mock-ats.test', path: '/*/jobs' }],
  fields: [{ id: 'title', kind: 'text' }, { id: 'link', kind: 'link' }],
  minimumConfidence: 0.8,
  linkFieldId: 'link',
  paginationCommandId: 'next-page',
  version: 1,
};

export const atsDetailPattern: SitePatternDefinition = {
  id: 'ats-detail',
  name: 'Mock ATS job posting',
  role: 'detail',
  appliesTo: [{ target: 'page', host: 'boards.mock-ats.test', path: '/*/jobs/*' }],
  fields: [
    { id: 'title', kind: 'text' },
    { id: 'company', kind: 'text' },
    { id: 'location', kind: 'text' },
    { id: 'description', kind: 'text' },
  ],
  minimumConfidence: 0.8,
  version: 1,
};

export function mockAtsSite(): MockSite {
  return {
    origin: ATS_ORIGIN,
    pages: {
      ...atsCompany('acme', 'Acme', [
        [job('eng-1', 'Senior Engineer', 'TypeScript and Rust'), job('eng-2', 'Platform Engineer', 'Go'), job('pm-1', 'Product Manager', 'roadmaps')],
        [job('eng-3', 'Frontend Engineer', 'TypeScript'), job('data-1', 'Data Engineer', 'SQL')],
      ]),
      ...atsCompany('globex', 'Globex', [[job('eng-1', 'Backend Engineer', 'TypeScript'), job('ops-1', 'SRE', 'Kubernetes')]]),
      ...atsCompany('initech', 'Initech', [[job('eng-1', 'Engineer', 'Java')]], { challenge: true }),
      ...atsCompany('cyberdyne', 'Cyberdyne', [[job('eng-1', 'Engineer', 'C++')]], { challenge: true }),
      ...atsCompany('wonka', 'Wonka', [[job('eng-1', 'Engineer', 'Rust'), job('eng-2', 'Senior Engineer', 'Rust')]], { jobPageWall: true }),
      ...atsCompany('hooli', 'Hooli', [[job('eng-1', 'Engineer I', 'Python'), job('eng-2', 'Engineer II', 'Python')]], { restoresOnBack: false }),
    },
  };
}

/** A second ATS host, used to show that different origins run concurrently. */
export function otherAtsSite(): MockSite {
  const pages = atsCompany('umbrella', 'Umbrella', [[job('eng-1', 'Engineer', 'TypeScript'), job('eng-2', 'Engineer', 'C++')]]);
  return { origin: OTHER_ATS_ORIGIN, pages };
}

export const otherAtsListingPattern: SitePatternDefinition = {
  ...atsListingPattern,
  id: 'ats-listing',
  appliesTo: [{ target: 'page', host: 'boards.mock-ats.test', path: '/*/jobs' }, { target: 'page', host: 'jobs.other-ats.test', path: '/*/jobs' }],
};

export const otherAtsDetailPattern: SitePatternDefinition = {
  ...atsDetailPattern,
  appliesTo: [{ target: 'page', host: 'boards.mock-ats.test', path: '/*/jobs/*' }, { target: 'page', host: 'jobs.other-ats.test', path: '/*/jobs/*' }],
};

/** The mock ATS listing pattern, also allowed to match the ATS when embedded as an iframe. */
export const atsListingWithFramePattern: SitePatternDefinition = {
  ...atsListingPattern,
  appliesTo: [...atsListingPattern.appliesTo, { target: 'frame', host: 'boards.mock-ats.test', path: '/*/jobs' }],
};

export const CAREERS_ORIGIN = 'https://www.acme-corp.test';

/** A company careers page that embeds its mock ATS board in an iframe. */
export function careersSite(): MockSite {
  return { origin: CAREERS_ORIGIN, pages: { '/careers': { frames: [{ src: `${ATS_ORIGIN}/acme/jobs` }] } } };
}

export const SIDE_PANE_ORIGIN = 'https://www.sidepane.test';

/** A board that shows each posting in a side pane after clicking its card. */
export function sidePaneSite(): MockSite {
  const jobs = [job('1', 'Data Scientist', 'Python'), job('2', 'ML Engineer', 'TypeScript')];
  return {
    origin: SIDE_PANE_ORIGIN,
    pages: {
      '/search': {
        matches: {
          'pane-listing': { confidence: 0.91, records: jobs.map((item) => ({ ref: `card-${item.slug}`, values: { title: item.title, link: `/view/${item.slug}` } })) },
        },
        panes: Object.fromEntries(jobs.map((item) => [`card-${item.slug}`, {
          matches: { 'pane-detail': { confidence: 0.88, records: [{ ref: `pane-${item.slug}`, values: { title: item.title, company: 'Sidepane Inc', description: item.description } }] } },
        }])),
      },
    },
  };
}

export const sidePaneListingPattern: SitePatternDefinition = {
  id: 'pane-listing',
  name: 'Side-pane board',
  role: 'listing',
  appliesTo: [{ target: 'page', host: 'www.sidepane.test', path: '/search' }],
  fields: [{ id: 'title', kind: 'text' }, { id: 'link', kind: 'link' }],
  minimumConfidence: 0.8,
  linkFieldId: 'link',
  itemCommandId: 'open-card',
  version: 1,
};

export const sidePaneDetailPattern: SitePatternDefinition = {
  id: 'pane-detail',
  name: 'Side-pane posting',
  role: 'detail',
  appliesTo: [{ target: 'page', host: 'www.sidepane.test', path: '/search' }],
  fields: [
    { id: 'title', kind: 'text' },
    { id: 'company', kind: 'text' },
    { id: 'description', kind: 'text' },
  ],
  minimumConfidence: 0.8,
  version: 1,
};

/** Markers shared by every customer of the white-labeled "TalentSuite" platform. */
export const TALENTSUITE_SIGNALS: PlatformSignal[] = [
  { kind: 'meta', name: 'generator', content: 'TalentSuite *' },
  { kind: 'resource', path: '/ClientResources/*' },
];

export const INITRODE_ORIGIN = 'https://careers.initrode.test';
export const INITRODE_HOSTED_ORIGIN = 'https://jobs.initrode-hosted.test';
export const VANDELAY_ORIGIN = 'https://careers.vandelay.test';

function talentSuiteCustomer(listingOrigin: string, detailOrigin: string, company: string, jobs: MockJob[]): MockSite[] {
  const detailPages = Object.fromEntries(jobs.map((item) => [`/Portal/Job.aspx?id=${item.slug}`, {
    signals: TALENTSUITE_SIGNALS,
    matches: { 'talentsuite-detail': { confidence: 0.86, records: [{ ref: `${company}-${item.slug}`, values: { title: item.title, company, description: item.description } }] } },
  } satisfies MockPage]));
  const listing: MockPage = {
    signals: [...TALENTSUITE_SIGNALS, { kind: 'form-field', name: '__VIEWSTATE' }],
    matches: {
      'talentsuite-listing': {
        confidence: 0.87,
        records: jobs.map((item) => ({ ref: `${company}-${item.slug}`, values: { title: item.title, link: `${detailOrigin}/Portal/Job.aspx?id=${item.slug}` } })),
      },
    },
  };
  if (listingOrigin === detailOrigin) return [{ origin: listingOrigin, pages: { '/Portal/Jobs.aspx': listing, ...detailPages } }];
  return [{ origin: listingOrigin, pages: { '/Portal/Jobs.aspx': listing } }, { origin: detailOrigin, pages: detailPages }];
}

export function talentSuiteSites(): MockSite[] {
  return [
    ...talentSuiteCustomer(INITRODE_ORIGIN, INITRODE_HOSTED_ORIGIN, 'Initrode', [job('11', 'Integration Engineer', 'TypeScript')]),
    ...talentSuiteCustomer(VANDELAY_ORIGIN, VANDELAY_ORIGIN, 'Vandelay', [job('21', 'Import Engineer', 'Go'), job('22', 'Export Engineer', 'Rust')]),
  ];
}

export const talentSuiteListingPattern: SitePatternDefinition = {
  id: 'talentsuite-listing',
  name: 'TalentSuite job list',
  role: 'listing',
  appliesTo: [{ target: 'fingerprint', signals: TALENTSUITE_SIGNALS }],
  fields: [{ id: 'title', kind: 'text' }, { id: 'link', kind: 'link' }],
  minimumConfidence: 0.8,
  linkFieldId: 'link',
  version: 1,
};

export const talentSuiteDetailPattern: SitePatternDefinition = {
  id: 'talentsuite-detail',
  name: 'TalentSuite posting',
  role: 'detail',
  appliesTo: [{ target: 'fingerprint', signals: TALENTSUITE_SIGNALS }],
  fields: [
    { id: 'title', kind: 'text' },
    { id: 'company', kind: 'text' },
    { id: 'description', kind: 'text' },
  ],
  minimumConfidence: 0.8,
  version: 1,
};

export function unknownSite(): MockSite {
  return { origin: UNKNOWN_ORIGIN, pages: { '/openings/7': {} } };
}

/** The fields the mock listings have. */
export const LISTING_FIELDS: CollectionField[] = [
  { id: 'title', label: 'Title', kind: 'text' },
  { id: 'company', label: 'Company', kind: 'text' },
  { id: 'location', label: 'Location', kind: 'text' },
  { id: 'description', label: 'Description', kind: 'long-text' },
];

/** Start pages for addresses, with ids in order. */
export function startPagesFor(urls: string[]): StartPage[] {
  return urls.map((url, index) => ({ id: `start-${index + 1}`, url }));
}

export function listingCollection(startUrls: string[], overrides: Partial<CollectionDefinition> = {}): CollectionDefinition {
  return {
    capabilityId: 'listings',
    name: 'Listings',
    fields: LISTING_FIELDS,
    startPages: startPagesFor(startUrls),
    sites: [],
    patterns: [atsListingPattern, atsDetailPattern],
    maxPages: 5,
    maxItems: 50,
    followLinksToOtherSites: false,
    ...overrides,
  };
}

/** Every simulated site: the job boards, and the signed-in service with its storage. */
export function mockWebSites<State>(api: MockApiIntegration<State>): MockSite[] {
  return [mockAtsSite(), otherAtsSite(), careersSite(), sidePaneSite(), ...talentSuiteSites(), unknownSite(), api.site, ...(api.extraSites ?? [])];
}
