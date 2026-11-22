import type { HomeCity } from '../../lib/aggregates';

interface Props {
  cities: HomeCity[];
}

export default function HomePage({ cities }: Props) {
  const ranked = [...cities].sort((a, b) => b.nonEuropeanShare - a.nonEuropeanShare);
  return (
    <main id="main" className="font-sans">
      <h1>How multicultural is your city?</h1>
      <ol>
        {ranked.map((city) => (
          <li key={city.slug}>
            <a href={`/${city.country}/${city.slug}/`}>{city.name}</a>
          </li>
        ))}
      </ol>
    </main>
  );
}
