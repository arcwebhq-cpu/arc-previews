import { mediaCoverageFixtures as v10MediaCoverageFixtures } from "./v10_media_coverage.mjs";

export const mediaCoverageFixtures = v10MediaCoverageFixtures.map(fixture => ({
  ...fixture,
  contractVersion: "arc-five-page-site-v1",
  expectedPageCount: 5,
  content: { ...fixture.content }
}));
