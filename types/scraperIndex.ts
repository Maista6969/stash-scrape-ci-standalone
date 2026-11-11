// one entry of CommunityScrapers' package index, as Stash reports it from availablePackages
export interface scraperPackage {
  id: string;
  name: string;
  sites: string[]; // scene URL patterns, matched by substring like Stash does
  requires: string[]; // package ids that must be installed alongside
}
