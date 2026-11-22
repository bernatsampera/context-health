import manifest from '../data/profile-manifest.json';

export interface HomeCity {
  slug: string;
  name: string;
  country: string;
  nonEuropeanShare: number;
}

export async function loadHomeCities(): Promise<HomeCity[]> {
  return manifest.cities
    .filter((city: { published: boolean }) => city.published)
    .map((city: HomeCity) => ({ ...city }));
}
