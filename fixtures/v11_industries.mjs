import { fixtures as v10LaunchFixtures } from "./v10_industries.mjs";

export const fixtures = v10LaunchFixtures.map(fixture => ({
  ...fixture,
  contractVersion: "arc-five-page-site-v1",
  expectedPageCount: 5,
  content: { ...fixture.content }
}));
