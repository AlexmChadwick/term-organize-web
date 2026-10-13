import { CourseView } from "@/components/course-view";

export default async function CoursePage({ params }: { params: Promise<{ term: string; subject: string; number: string }> }) {
  const { term, subject, number } = await params;
  return <CourseView term={term} subject={decodeURIComponent(subject).toUpperCase()} number={decodeURIComponent(number).toUpperCase()} />;
}
