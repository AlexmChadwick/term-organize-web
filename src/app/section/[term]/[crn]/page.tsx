import { SectionView } from "@/components/section-view";

export default async function SectionPage({ params }: { params: Promise<{ term: string; crn: string }> }) {
  const { term, crn } = await params;
  return <SectionView term={term} crn={decodeURIComponent(crn)} />;
}
