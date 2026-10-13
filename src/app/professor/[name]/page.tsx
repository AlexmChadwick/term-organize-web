import { ProfessorView } from "@/components/professor-view";

export default async function ProfessorPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <ProfessorView name={decodeURIComponent(name)} />;
}
