import { CatalogCourse, CatalogLesson, CourseProgressView, PublicQuiz } from '../api/types';

/**
 * Shared course-navigation helpers used by the Academy hub, course, lesson
 * and quiz screens -- kept in one place so "what's next" is computed the
 * same way everywhere (module lessons in order, then that module's quiz,
 * then the final assessment), matching the website's AcademyLearningHub.
 */
export type CourseItem =
  | { type: 'lesson'; id: string; title: string; lesson: CatalogLesson }
  | { type: 'quiz'; id: string; title: string; quiz: PublicQuiz };

export function flattenCourseItems(course: CatalogCourse): CourseItem[] {
  const items: CourseItem[] = [];
  for (const module of course.modules) {
    for (const lesson of module.lessons) items.push({ type: 'lesson', id: lesson.id, title: lesson.title, lesson });
    if (module.quiz) items.push({ type: 'quiz', id: module.quiz.id, title: module.quiz.title, quiz: module.quiz });
  }
  if (course.finalAssessment) {
    items.push({ type: 'quiz', id: course.finalAssessment.id, title: course.finalAssessment.title, quiz: course.finalAssessment });
  }
  return items;
}

export function nextCourseItem(course: CatalogCourse, type: 'lesson' | 'quiz', id: string): CourseItem | undefined {
  const items = flattenCourseItems(course);
  const idx = items.findIndex((it) => it.type === type && it.id === id);
  return idx >= 0 ? items[idx + 1] : undefined;
}

/** The next thing this learner hasn't finished in this course, or undefined once every lesson and quiz is done. */
export function firstIncompleteItem(course: CatalogCourse, progress: CourseProgressView | null | undefined): CourseItem | undefined {
  const items = flattenCourseItems(course);
  if (!progress) return items[0];
  const completedLessons = new Set(progress.completed_lesson_ids);
  for (const item of items) {
    if (item.type === 'lesson') {
      if (!completedLessons.has(item.id)) return item;
      continue;
    }
    const moduleView = progress.modules.find((m) => m.quiz_id === item.id);
    if (moduleView) {
      if (!moduleView.quiz_passed) return item;
      continue;
    }
    if (progress.final_assessment_id === item.id && !progress.final_assessment_passed) return item;
  }
  return undefined;
}

export function findQuizInCourse(course: CatalogCourse, quizId: string): PublicQuiz | undefined {
  if (course.finalAssessment?.id === quizId) return course.finalAssessment;
  for (const module of course.modules) {
    if (module.quiz?.id === quizId) return module.quiz;
  }
  return undefined;
}

export function courseMatchesQuery(course: CatalogCourse, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    course.title, course.summary, ...course.tags,
    ...course.modules.flatMap((m) => [m.title, ...m.lessons.flatMap((l) => [l.title, ...l.sections.flat()])]),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}
