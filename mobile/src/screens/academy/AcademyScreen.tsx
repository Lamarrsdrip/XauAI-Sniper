import React, { useCallback, useEffect, useState } from 'react';
import { View, RefreshControl, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AcademyStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header, Input, ProgressBar } from '../../components';
import { Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { cloud } from '../../api/cloud';
import { CatalogCourse, CourseLevel, CourseProgressView } from '../../api/types';
import { USE_MOCK_DATA } from '../../api/config';
import { mockAcademyCatalog, mockCourseProgressFor } from '../../state/mockData';
import { courseMatchesQuery, firstIncompleteItem } from '../../state/academy';
import { CertificatePanel } from './CertificatePanel';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<AcademyStackParamList, 'Academy'>;

const LEVELS: { key: CourseLevel; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'specialist', label: 'Specialist' },
];

export const AcademyScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing, radius } = useTheme();
  const [catalog, setCatalog] = useState<CatalogCourse[] | null>(null);
  const [progressByCourse, setProgressByCourse] = useState<Record<string, CourseProgressView>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      if (USE_MOCK_DATA) {
        setCatalog(mockAcademyCatalog.courses);
        setProgressByCourse(Object.fromEntries(mockAcademyCatalog.courses.map((c) => [c.id, mockCourseProgressFor(c.id)])));
        return;
      }
      const { courses } = await cloud.academyCatalog();
      setCatalog(courses);
      const rows = await Promise.all(
        courses.map(async (c) => {
          try {
            return [c.id, await cloud.courseProgress(c.id)] as const;
          } catch {
            return [c.id, null] as const;
          }
        })
      );
      setProgressByCourse(Object.fromEntries(rows.filter((r): r is [string, CourseProgressView] => !!r[1])));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the Academy. Pull to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !catalog) {
    return (
      <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
        <Header title="Academy" large />
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}>
          <Skeleton height={110} />
          <Skeleton height={70} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </View>
      </Screen>
    );
  }
  if (error && !catalog) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']}>
        <Header title="Academy" large />
        <ErrorState title="Couldn't load Academy" message={error} onAction={() => load()} />
      </Screen>
    );
  }

  const courses = catalog ?? [];
  const totalLessons = courses.reduce((sum, c) => sum + c.modules.reduce((n, m) => n + m.lessons.length, 0), 0);
  const doneLessons = Object.values(progressByCourse).reduce((sum, p) => sum + p.completed_lesson_count, 0);
  const overallPct = totalLessons ? Math.round((doneLessons / totalLessons) * 100) : 0;
  const matching = courses.filter((c) => courseMatchesQuery(c, query));
  const nextCourse = courses.find((c) => !progressByCourse[c.id]?.course_complete) ?? courses[0];
  const nextItem = nextCourse ? firstIncompleteItem(nextCourse, progressByCourse[nextCourse.id]) : undefined;

  const goToNext = () => {
    if (!nextCourse) return;
    if (!nextItem) return navigation.navigate('Course', { courseId: nextCourse.id });
    if (nextItem.type === 'lesson') navigation.navigate('Lesson', { courseId: nextCourse.id, lessonId: nextItem.id });
    else navigation.navigate('Quiz', { courseId: nextCourse.id, quizId: nextItem.id });
  };

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Academy" large />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: spacing.xxxl, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.brand} />}
      >
        <View>
          <Text variant="caption" color="secondary">XAUCLOUD FOREX ACADEMY</Text>
          <Text variant="h1" style={{ marginTop: 4 }}>Learn trading, one path.</Text>
          <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
            Market mechanics, price action, risk, psychology, gold and automation — one learning path, one progress bar.
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text variant="caption" color="tertiary">Overall Academy progress</Text>
              <Text variant="caption" color="tertiary">{doneLessons}/{totalLessons} lessons</Text>
            </View>
            <ProgressBar pct={overallPct} />
          </View>
        </View>

        <CertificatePanel
          title="Foundations Certificate"
          incompleteMessage="Complete the foundational lessons (now inside the courses below) to unlock it."
          downloadPath="/cloud/academy/certificate/download"
          fileName="xaucloud-academy-foundations-certificate.pdf"
          fetchStatus={cloud.academyCertificate}
          confirmName={cloud.confirmAcademyCertificateName as (name: string) => Promise<{ certificate: { certificate_id: string; recipient_name: string } }>}
          refreshKey={doneLessons}
        />

        {nextCourse && (
          <Card onPress={goToNext} style={{ backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
            <Text variant="caption" color="brand">CONTINUE LEARNING · RECOMMENDED NEXT</Text>
            <Text variant="h2" style={{ marginTop: 4 }}>{nextItem ? nextItem.title : nextCourse.title}</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
              {nextItem ? nextCourse.title : 'Course complete'} · {progressByCourse[nextCourse.id]?.progress_pct ?? 0}% complete
            </Text>
          </Card>
        )}

        <Input
          placeholder="Search RSI, Gold, Pips, Risk, Bitcoin, MT5, Psychology…"
          value={query}
          onChangeText={setQuery}
        />

        {LEVELS.map(({ key, label }) => {
          const rows = matching.filter((c) => c.level === key);
          if (!rows.length) return null;
          return (
            <View key={key}>
              <Text variant="caption" color="tertiary" style={{ marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
              <View style={{ gap: spacing.sm }}>
                {rows.map((course) => {
                  const p = progressByCourse[course.id];
                  const complete = !!p?.course_complete;
                  return (
                    <Card key={course.id} onPress={() => navigation.navigate('Course', { courseId: course.id })}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name={complete ? 'checkmark-circle' : 'book-outline'} size={18} color={colors.brand} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium">{course.title}</Text>
                          <Text variant="caption" color="secondary" numberOfLines={2} style={{ marginTop: 2 }}>{course.summary}</Text>
                          <View style={{ marginTop: spacing.xs }}>
                            <ProgressBar pct={p?.progress_pct ?? 0} />
                          </View>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            </View>
          );
        })}

        {error && catalog && <Text variant="caption" color="sell">{error}</Text>}
      </ScrollView>
    </Screen>
  );
};
