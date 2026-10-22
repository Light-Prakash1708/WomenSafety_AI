// National helplines shown in Support. Every entry carries the source it was checked against and when.
// Re-check every quarter (docs/OPERATIONS.md). If a number can't be confirmed from an official or
// well-attributed source, it is removed rather than guessed. 112 is always listed first.
export type Helpline = {
  number: string;
  name: string;
  purpose: string;
  hours: string;
  source: string;
  sourceUrl: string;
  checked: string; // ISO date the number was last checked against the source
};

export const DIRECTORY_CHECKED = "2026-10-22";

export const HELPLINES: Helpline[] = [
  {
    number: "112",
    name: "Emergency (police, ambulance, fire)",
    purpose: "Danger right now",
    hours: "24×7",
    source: "Ministry of Education, National Task Force student support list",
    sourceUrl: "https://ntf.education.gov.in/?p=7452",
    checked: DIRECTORY_CHECKED,
  },
  {
    number: "181",
    name: "Women Helpline",
    purpose: "Advice, shelter, One Stop Centre referral",
    hours: "24×7",
    source: "Ministry of Education, National Task Force student support list",
    sourceUrl: "https://ntf.education.gov.in/?p=7452",
    checked: DIRECTORY_CHECKED,
  },
  {
    number: "14490",
    name: "NCW Women Helpline",
    purpose: "National Commission for Women; linked to its earlier number 7827170170",
    hours: "24×7",
    source: "The Tribune, NCW launch report (Nov 2025)",
    sourceUrl: "https://www.tribuneindia.com/news/india/ncw-launches-24x7-short-code-helpline-14490-for-women-in-distress",
    checked: DIRECTORY_CHECKED,
  },
  {
    number: "1930",
    name: "Cyber Crime Helpline",
    purpose: "Online harassment, leaked photos, fraud. Also cybercrime.gov.in",
    hours: "24×7",
    source: "Ministry of Education, National Task Force student support list",
    sourceUrl: "https://ntf.education.gov.in/?p=7452",
    checked: DIRECTORY_CHECKED,
  },
  {
    number: "15100",
    name: "Legal Aid Helpline",
    purpose: "Free legal help",
    hours: "Mon–Fri, 9:30 am–5 pm",
    source: "Ministry of Education, National Task Force student support list",
    sourceUrl: "https://ntf.education.gov.in/?p=7452",
    checked: DIRECTORY_CHECKED,
  },
  {
    number: "14416",
    name: "Tele-MANAS",
    purpose: "Free mental health support in your language. Also 1800-891-4416",
    hours: "24×7",
    source: "Ministry of Education, National Task Force student support list",
    sourceUrl: "https://ntf.education.gov.in/?p=7452",
    checked: DIRECTORY_CHECKED,
  },
  {
    number: "1098",
    name: "Child Helpline",
    purpose: "If the person is under 18",
    hours: "24×7",
    source: "Vikaspedia (Government of India), Child Helpline service",
    sourceUrl: "https://vikaspedia.in/education/childrens-corner/child-rights/child-helpline-service",
    checked: DIRECTORY_CHECKED,
  },
];
