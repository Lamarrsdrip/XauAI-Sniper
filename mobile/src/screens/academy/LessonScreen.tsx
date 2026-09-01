import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AcademyStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header, Button } from '../../components';
import { Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { cloud } from '../../api/cloud';
import { CatalogCourse, CatalogLesson, CourseProgressView } from '../../api/types';
import { USE_MOCK_DATA } from '../../api/config';
import { mockAcademyCatalog, mockCourseProgressFor } from '../../state/mockData';
import { nextCourseItem } from '../../state/academy';
import { KnowledgeCheckCard } from './KnowledgeCheckCard';
import { isSpeechAvailable, pauseReading, readLesson, resumeReading, stopReading, supportsSpeechPause } from '../../services/speech';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<AcademyStackParamList, 'Lesson'>;

function findLesson(course: CatalogCourse | null, lessonId: string): CatalogLesson | null {
  if (!course) return null;
  for (const module of course.modules) {
    const lesson = module.lessons.find((l) => l.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
}

export const LessonScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId, lessonId } = route.params;
  const { colors, spacing } = useTheme();
  const [course, setCourse] = useState<CatalogCourse | null>(null);
  const [progress, setProgress] = useState<CourseProgressView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [speechState, setSpeechState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.9);

  const load = useCallback(async () => {
    setLoading(true);
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
      setError(e?.message ?? 'Could not load this lesson.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => stopReading(), []);

  // Keep every hook above the loading/error returns. `lesson` can be absent
  // while the catalog is loading, so derive a harmless empty narration first.
  const lesson = findLesson(course, lessonId);
  const lessonSpeechText = useMemo(() => lesson ? [
    lesson.title,
    'Learning objectives.',
    ...lesson.objectives,
    ...lesson.sections.flatMap(([heading, body]) => [heading, body]),
    'Common mistakes.',
    ...lesson.commonMistakes,
    'Key takeaways.',
    ...lesson.keyTakeaways,
  ].join('. ') : '', [lesson]);

  if (loading && !course) {
    return (
      <Screen>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={80} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }
  if (error && !lesson) {
    return (
      <Screen>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <ErrorState title="Couldn't load lesson" message={error} onAction={load} />
      </Screen>
    );
  }
  if (!course || !lesson) {
    return (
      <Screen>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <ErrorState title="Lesson not found" message="This lesson may have moved." />
      </Screen>
    );
  }

  const isComplete = (progress?.completed_lesson_ids ?? []).includes(lesson.id);
  const next = nextCourseItem(course, 'lesson', lesson.id);

  const toggleSpeech = () => {
    if (speechState === 'playing') {
      if (supportsSpeechPause) {
        pauseReading();
        setSpeechState('paused');
      } else {
        stopReading();
        setSpeechState('idle');
      }
      return;
    }
    if (speechState === 'paused') {
      resumeReading();
      setSpeechState('playing');
      return;
    }
    setSpeechUnavailable(false);
    setSpeechState('playing');
    if (!readLesson(lessonSpeechText, () => setSpeechState('idle'), speechRate)) {
      setSpeechState('idle');
      setSpeechUnavailable(true);
    }
  };

  const toggleComplete = async () => {
    setSaving(true);
    try {
      if (USE_MOCK_DATA) {
        await new Promise((r) => setTimeout(r, 300));
      } else if (isComplete) {
        setProgress(await cloud.uncompleteCourseLesson(courseId, lesson.id));
      } else {
        setProgress(await cloud.completeCourseLesson(courseId, lesson.id));
      }
    } finally {
      setSaving(false);
    }
  };

  const goToNext = () => {
    if (!next) return;
    if (next.type === 'lesson') navigation.replace('Lesson', { courseId, lessonId: next.id });
    else navigation.replace('Quiz', { courseId, quizId: next.id });
  };

  return (
    <Screen>
      <Header title={course.title} onBack={() => goBackOrNavigate(navigation, 'Academy')} />
      <Text variant="h1" style={{ marginTop: spacing.xs }}>{lesson.title}</Text>
      <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>About {lesson.estimatedMinutes} minutes</Text>

      <Button
        label={speechState === 'playing' ? (supportsSpeechPause ? 'Pause reading' : 'Stop reading') : speechState === 'paused' ? 'Resume reading' : 'Read lesson aloud'}
        variant="secondary"
        onPress={toggleSpeech}
        style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
      />
      <Button
        label={`Speed ${speechRate.toFixed(1)}×`}
        variant="ghost"
        onPress={() => setSpeechRate((value) => value >= 1.1 ? 0.8 : Number((value + 0.1).toFixed(1)))}
        style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}
      />
      {speechUnavailable || !isSpeechAvailable() ? (
        <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>
          Read aloud will be available after installing the latest XauCloud preview build.
        </Text>
      ) : null}

      <Card style={{ marginTop: spacing.md }}>
        <Text variant="h3">Learning objectives</Text>
        <View style={{ marginTop: spacing.xs, gap: 4 }}>
          {lesson.objectives.map((item) => (
            <Text key={item} variant="body" color="secondary">• {item}</Text>
          ))}
        </View>
      </Card>

      {lesson.sections.map(([heading, body]) => (
        <Card key={heading} style={{ marginTop: spacing.sm }}>
          <Text variant="h2">{heading}</Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.sm, lineHeight: 22 }}>{body}</Text>
        </Card>
      ))}

      <Card style={{ marginTop: spacing.sm, backgroundColor: colors.sellBg, borderColor: 'transparent' }}>
        <Text variant="h3" color="sell">Common mistakes</Text>
        <View style={{ marginTop: spacing.xs, gap: 4 }}>
          {lesson.commonMistakes.map((item) => (
            <Text key={item} variant="body" color="secondary">• {item}</Text>
          ))}
        </View>
      </Card>

      <Card style={{ marginTop: spacing.sm, backgroundColor: colors.buyBg, borderColor: 'transparent' }}>
        <Text variant="h3" color="buy">Key takeaways</Text>
        <View style={{ marginTop: spacing.xs, gap: 4 }}>
          {lesson.keyTakeaways.map((item) => (
            <Text key={item} variant="body" color="secondary">• {item}</Text>
          ))}
        </View>
      </Card>

      {lesson.knowledgeCheck?.map((question) => (
        <KnowledgeCheckCard key={question.id} question={question} />
      ))}

      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <Button
          label={isComplete ? 'Completed ✓' : 'Mark lesson complete'}
          fullWidth
          loading={saving}
          variant={isComplete ? 'secondary' : 'primary'}
          onPress={toggleComplete}
        />
        {next ? (
          <Button label={`Next: ${next.title}`} variant="ghost" fullWidth onPress={goToNext} />
        ) : (
          <Text variant="caption" color="tertiary" align="center">You've reached the end of this course.</Text>
        )}
      </View>
    </Screen>
  );
};
