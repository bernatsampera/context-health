interface Props {
  slug: string;
}

export default function CityMap({ slug }: Props) {
  return <div id={`map-${slug}`} className="h-96 w-full" />;
}
