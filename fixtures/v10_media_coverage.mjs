import { fixture } from "./v10_industries.mjs";

const profiles = [
  { id: "b2000001", profile: "dental", industry: "Dental Practice", business: "Cedar Dental Concept", service: "Preventive Dentistry", primary: "#165b63", accent: "#ca8a04" },
  { id: "b2000002", profile: "plumbing", industry: "Plumbing and Water Heaters", business: "Copperline Plumbing Concept", service: "Water Heater Service", primary: "#155e75", accent: "#ea580c" },
  { id: "b2000003", profile: "home_services", industry: "General Contractor", business: "Northstar Contractor Concept", service: "Residential Construction", primary: "#334155", accent: "#d97706" },
  { id: "b2000004", profile: "medical_spa", industry: "Medical Spa and Aesthetic Treatments", business: "Aster Medical Spa Concept", service: "Aesthetic Consultation", primary: "#7c3a5d", accent: "#c08457" },
  { id: "b2000005", profile: "healthcare", industry: "Healthcare Clinic", business: "Harbor Health Clinic Concept", service: "Primary Care", primary: "#155e75", accent: "#0d9488" },
  { id: "b2000006", profile: "restaurant", industry: "Restaurant and Catering", business: "Juniper Table Concept", service: "Seasonal Dining", primary: "#6b3f2a", accent: "#b45309" },
  { id: "b2000007", profile: "real_estate", industry: "Real Estate Brokerage", business: "Stonebridge Realty Concept", service: "Home Buying Guidance", primary: "#1e3a5f", accent: "#b08952" },
  { id: "b2000008", profile: "fitness", industry: "Fitness and Personal Training", business: "Foundry Fitness Concept", service: "Personal Training", primary: "#1f2937", accent: "#dc2626" },
  { id: "b2000009", profile: "legal", industry: "Law Firm and Legal Counsel", business: "Northline Law Concept", service: "Legal Consultation", primary: "#172554", accent: "#a16207" },
  { id: "b2000010", profile: "finance", industry: "Accounting and Financial Planning", business: "Clearwater Finance Concept", service: "Financial Planning", primary: "#173f35", accent: "#b08952" },
  { id: "b2000011", profile: "web_design", industry: "Website Design Agency", business: "ARC Digital Studio Concept", service: "Website Design", primary: "#312e81", accent: "#db2777" },
  { id: "b2000012", profile: "technology", industry: "Software and IT Services", business: "Signal Technology Concept", service: "Software Consulting", primary: "#0f3d56", accent: "#0284c7" },
  { id: "b2000013", profile: "beauty", industry: "Beauty Salon and Skincare", business: "Sable Beauty Concept", service: "Skincare Services", primary: "#713f5f", accent: "#be185d" },
  { id: "b2000014", profile: "general", industry: "Local Business", business: "Main Street Business Concept", service: "Customer Service", primary: "#334155", accent: "#0f766e" }
];

export const mediaCoverageFixtures = profiles.map(spec => fixture({
  id: spec.id,
  profile: spec.profile,
  isLaunch: false,
  business: spec.business,
  industry: spec.industry,
  location: "Quality Assurance Market",
  primary: spec.primary,
  accent: spec.accent,
  style: "premium",
  cta: "Request an introduction",
  primaryService: spec.service,
  headline: `${spec.industry}, presented with clarity.`,
  subheadline: `A fictional ARC quality-assurance concept for ${spec.industry.toLowerCase()}, built to verify semantic media, responsive composition, and an honest conversion path.`,
  visualHeadline: `${spec.service}, clearly framed`,
  proofLine: "Clear scope • Honest proof • Responsive experience",
  servicesHeading: `${spec.industry} services made easier to understand`,
  servicesIntro: `A focused service structure for prospective customers evaluating ${spec.industry.toLowerCase()}.`,
  services: [
    [spec.service, `A clear introduction to ${spec.service.toLowerCase()} with the next step stated plainly.`],
    [`${spec.industry} Planning`, "Organize priorities, timing, and practical requirements before work begins."],
    [`${spec.industry} Support`, "Explain what customers can expect before, during, and after the service."],
    ["Customer Guidance", "Answer common questions without inventing outcomes, ratings, licenses, or guarantees."]
  ],
  differentiators: [
    ["Readable scope", "Services and next steps are easy to scan on desktop and mobile."],
    ["Honest evidence", "The concept does not publish unsupported reviews, results, or credentials."],
    ["Useful sequence", "The customer journey explains what happens before a commitment."],
    ["Visible action", "A single primary action stays clear throughout the experience."]
  ],
  aboutTitle: `${spec.business} is a semantic media test`,
  aboutBody: `This fictional concept verifies that ARC selects the ${spec.profile.replace("_", " ")} media profile and a suitable composition without presenting stock imagery as client work.`,
  aboutQuote: "Specific visuals. Verifiable claims. One clear next step.",
  processHeading: `A straightforward ${spec.industry.toLowerCase()} journey`,
  process: [
    ["Share the need", "Describe the situation, priorities, and desired timing."],
    ["Review the fit", "A real provider would confirm service area, scope, and required information."],
    ["Compare the path", "Discuss practical options and the tradeoffs that matter."],
    ["Confirm next steps", "Agree on scope, timing, access, and communication before work begins."]
  ],
  faqs: [
    ["What should a customer share first?", "The need, location, timing, and any constraints make the first response more useful."],
    ["Are the images client work?", "No. Licensed stock imagery is used only as visual direction in this fictional QA concept."],
    ["Are the results and reviews real?", "No unsupported result, rating, review, license, or guarantee is published here."],
    ["What happens after the request?", "A real provider would verify fit and explain the appropriate next step."]
  ],
  contactHeading: `Start a clear ${spec.industry.toLowerCase()} conversation`,
  contactBody: "Share the need and timing. A real provider would confirm fit before recommending a service path."
}));
