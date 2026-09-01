import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, RefreshControl, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AcademyStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header, ProgressBar } from '../../components';
import { Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { cloud } from '../../api/cloud';
import { CatalogCourse, CourseLevel, CourseProgressView } from '../../api/types';
import { USE_MOCK_DATA } from '../../api/config';
import { mockAcademyCatalog, mockCourseProgressFor } from '../../state/mockData';
import { firstIncompleteItem } from '../../state/academy';
import { CertificatePanel } from './CertificatePanel';
import { Ionicons } from '@expo/vector-icons';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<AcademyStackParamList, 'Course'>;

const LEVEL_LABEL: Record<CourseLevel, string> = {
  beginner: 'Beginner', foundation: 'Foundation', intermediate: 'Intermediate', advanced: 'Advanced', specialist: 'Specialist',
};

export const CourseScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId } = route.params;
  const { colors, spacing, radius } = useTheme();
  const [course, setCourse] = useState<CatalogCourse | null>(null);
  const [progress, setProgress] = useState<CourseProgressView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      if (USE_MOCK_DATA) {
        setCourse(mockAcademyCatalog.courses.find((c) => c.id === courseId) ?? null);
        setProgress(mockCourseProgressFor(courseId));
        return;
      }
      const [{ courses }, courseProgress] = await Promise.all([cloud.academyCatalog(), cloud.courseProgress(courseId)]);
      setCourse(courses.find((c) => c.id === courseId) ?? null);
      setProgress(courseProgress);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this course. Pull to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !course) {
    return (
      <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}>
          <Skeleton height={120} />
          <Skeleton height={90} />
          <Skeleton height={90} />
        </View>
      </Screen>
    );
  }
  if (error && !course) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']}>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <ErrorState title="Couldn't load course" message={error} onAction={() => load()} />
      </Screen>
    );
  }
  if (!course) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']}>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <ErrorState title="Course not found" message="This course may have moved. Go back to the Academy home." />
      </Screen>
    );
  }

  const resume = firstIncompleteItem(course, progress);

  const openLesson = (lessonId: string) => navigation.navigate('Lesson', { courseId, lessonId });
  const openQuiz = (quizId: string) => navigation.navigate('Quiz', { courseId, quizId });

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: spacing.xxxl, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.brand} />}
      >
        <View>
          <Text variant="caption" color="brand" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{LEVEL_LABEL[course.level]} course</Text>
          <Text variant="h1" style={{ marginTop: 4 }}>{course.title}</Text>
          <Text variant="body" color="secondary" style={{ marginTop: 6, lineHeight: 21 }}>{course.summary}</Text>
          <View style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text variant="caption" color="tertiary">Your progress</Text>
              <Text variant="caption" color="tertiary">{progress?.completed_lesson_count ?? 0}/{progress?.total_lesson_count ?? 0} lessons</Text>
            </View>
            <ProgressBar pct={progress?.progress_pct ?? 0} />
          </View>
        </View>

        {resume && (
          <Card
            onPress={() => (resume.type === 'lesson' ? openLesson(resume.id) : openQuiz(resume.id))}
            style={{ backgroundColor: colors.brandMuted, borderColor: 'transparent' }}
          >
            <Text variant="caption" color="brand">CONTINUE LEARNING</Text>
            <Text variant="h2" style={{ marginTop: 4 }}>{resume.title}</Text>
          </Card>
        )}

        {course.modules.map((module, index) => {
          const mp = progress?.modules.find((m) => m.module_id === module.id);
          return (
            <View key={module.id} style={{ borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
                <Text variant="micro" color="brand">MODULE {index + 1}</Text>
                <Text variant="bodyMedium" style={{ marginTop: 2 }}>{module.title}</Text>
                <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
                  {mp?.completed_lesson_count ?? 0}/{module.lessons.length} lessons · {mp?.quiz_passed ? 'Quiz passed' : module.quiz ? 'Quiz pending' : 'No quiz'}
                </Text>
              </View>
              {module.lessons.map((lesson) => {
                const done = (progress?.completed_lesson_ids ?? []).includes(lesson.id);
                return (
                  <Pressable
                    key={lesson.id}
                    onPress={() => openLesson(lesson.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" style={{ fontWeight: '600' }}>{lesson.title}</Text>
                      <Text variant="micro" color="tertiary" style={{ marginTop: 2 }}>{lesson.estimatedMinutes} min · {done ? 'Completed' : 'Open lesson'}</Text>
                    </View>
                    <Ionicons name={done ? 'checkmark-circle' : 'chevron-forward'} size={18} color={done ? colors.buy : colors.textTertiary} />
                  </Pressable>
                );
              })}
              {module.quiz && (
                <Pressable
                  onPress={() => openQuiz(module.quiz!.id)}
                  style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
                >
                  <Text variant="captionMedium" color={mp?.quiz_passed ? 'buy' : 'brand'}>
                    {mp?.quiz_passed ? '✓ Module quiz passed' : 'Take module quiz'} · {module.quiz.questionCount} questions
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {course.finalAssessment && (
          <Card onPress={() => openQuiz(course.finalAssessment!.id)}>
            <Text variant="bodyMedium" color={progress?.final_assessment_passed ? 'buy' : 'primary'}>
              {progress?.final_assessment_passed ? '✓ Final assessment passed' : 'Take final assessment'}
            </Text>
            <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>{course.finalAssessment.questionCount} questions</Text>
          </Card>
        )}

        {course.certificateEligible && (
          <CertificatePanel
            title="Course Certificate"
            incompleteMessage="Pass every lesson, module quiz and the final assessment to unlock it."
            downloadPath={`/cloud/academy/courses/${encodeURIComponent(courseId)}/certificate/download`}
            fileName={`xaucloud-${courseId}-certificate.pdf`}
            fetchStatus={() => cloud.courseCertificate(courseId)}
            confirmName={(name) => cloud.confirmCourseCertificateName(courseId, name)}
            refreshKey={progress?.completed_lesson_count}
          />
        )}

        {error && course && <Text variant="caption" color="sell">{error}</Text>}
      </ScrollView>
    </Screen>
  );
};
