import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AcademyStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header, Button } from '../../components';
import { Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { cloud } from '../../api/cloud';
import { CatalogCourse, PublicQuiz, QuizSubmitResult } from '../../api/types';
import { USE_MOCK_DATA } from '../../api/config';
import { mockAcademyCatalog } from '../../state/mockData';
import { findQuizInCourse, nextCourseItem } from '../../state/academy';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<AcademyStackParamList, 'Quiz'>;

export const QuizScreen: React.FC<Props> = ({ route, navigation }) => {
  const { courseId, quizId } = route.params;
  const { colors, spacing, radius } = useTheme();
  const [course, setCourse] = useState<CatalogCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (USE_MOCK_DATA) {
        setCourse(mockAcademyCatalog.courses.find((c) => c.id === courseId) ?? null);
        return;
      }
      const { courses } = await cloud.academyCatalog();
      setCourse(courses.find((c) => c.id === courseId) ?? null);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load this assessment.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !course) {
    return (
      <Screen>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={80} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </View>
      </Screen>
    );
  }
  const quiz: PublicQuiz | undefined = course ? findQuizInCourse(course, quizId) : undefined;
  if ((loadError && !quiz) || !course || !quiz) {
    return (
      <Screen>
        <Header onBack={() => goBackOrNavigate(navigation, 'Academy')} />
        <ErrorState title="Couldn't load assessment" message={loadError ?? 'This assessment may have moved.'} onAction={load} />
      </Screen>
    );
  }

  const choose = (questionId: string, optionId: string, multiple: boolean) => {
    setAnswers((old) => {
      const previous = old[questionId] ?? [];
      const next = multiple
        ? previous.includes(optionId) ? previous.filter((x) => x !== optionId) : [...previous, optionId]
        : [optionId];
      return { ...old, [questionId]: next };
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (USE_MOCK_DATA) {
        await new Promise((r) => setTimeout(r, 400));
        setResult({
          quiz_id: quiz.id, score_pct: 100, passed: true, passing_score_pct: quiz.passingScorePct, attempt_number: 1,
          correct_count: quiz.questions.length, total_count: quiz.questions.length,
          per_question: quiz.questions.map((q) => ({ question_id: q.id, correct: true, correct_option_ids: [], explanation: 'Preview mode — grading is simulated.' })),
        });
        return;
      }
      setResult(await cloud.submitQuiz(courseId, quiz.id, answers));
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Could not grade this assessment.');
    } finally {
      setSubmitting(false);
    }
  };

  const retake = () => {
    setAnswers({});
    setResult(null);
    setSubmitError(null);
  };

  const next = nextCourseItem(course, 'quiz', quiz.id);
  const goToNext = () => {
    if (!next) return;
    if (next.type === 'lesson') navigation.replace('Lesson', { courseId, lessonId: next.id });
    else navigation.replace('Quiz', { courseId, quizId: next.id });
  };

  const gradingFor = (questionId: string) => result?.per_question.find((r) => r.question_id === questionId);

  return (
    <Screen>
      <Header title={course.title} onBack={() => goBackOrNavigate(navigation, 'Academy')} />
      <Card>
        <Text variant="caption" color="brand">SERVER-GRADED ASSESSMENT</Text>
        <Text variant="h2" style={{ marginTop: 4 }}>{quiz.title}</Text>
        <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
          {quiz.questionCount} questions · {quiz.passingScorePct}% required · retakes are allowed
        </Text>
      </Card>

      {quiz.questions.map((question, index) => {
        const grading = gradingFor(question.id);
        const multiple = question.type === 'multi';
        return (
          <Card key={question.id} style={{ marginTop: spacing.sm }}>
            <Text variant="micro" color="tertiary">QUESTION {index + 1} · {question.type.replace(/_/g, ' ').toUpperCase()}</Text>
            <Text variant="bodyMedium" style={{ marginTop: 6 }}>{question.prompt}</Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.xxs }}>
              {question.options.map((option) => {
                const active = (answers[question.id] ?? []).includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    disabled={!!result}
                    onPress={() => choose(question.id, option.id, multiple)}
                    style={{
                      paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md,
                      backgroundColor: active ? colors.brand : colors.disabledBg,
                    }}
                  >
                    <Text variant="caption" style={{ color: active ? colors.brandOn : colors.textPrimary }}>{option.text}</Text>
                  </Pressable>
                );
              })}
            </View>
            {grading && (
              <Text variant="caption" color={grading.correct ? 'buy' : 'sell'} style={{ marginTop: spacing.sm, lineHeight: 18 }}>
                <Text variant="captionMedium" color={grading.correct ? 'buy' : 'sell'}>{grading.correct ? 'Correct. ' : 'Incorrect. '}</Text>
                {grading.explanation}
              </Text>
            )}
          </Card>
        );
      })}

      {!result ? (
        <Button
          label={submitting ? 'Grading…' : 'Submit assessment'}
          loading={submitting}
          fullWidth
          style={{ marginTop: spacing.md }}
          onPress={submit}
        />
      ) : (
        <Card style={{ marginTop: spacing.md, backgroundColor: result.passed ? colors.buyBg : colors.sellBg, borderColor: 'transparent' }}>
          <Text variant="bodyMedium" color={result.passed ? 'buy' : 'sell'}>
            {result.passed ? 'Passed' : 'Not passed yet'} · {result.score_pct}%
          </Text>
          <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
            Attempt {result.attempt_number} · {result.correct_count}/{result.total_count} correct.{' '}
            {result.passed ? 'Your progress has been saved.' : 'Review the explanations and retake whenever you are ready.'}
          </Text>
        </Card>
      )}

      {result && (
        result.passed ? (
          next ? (
            <Button label={`Next: ${next.title}`} fullWidth style={{ marginTop: spacing.sm }} onPress={goToNext} />
          ) : (
            <Text variant="caption" color="tertiary" align="center" style={{ marginTop: spacing.sm }}>You've reached the end of this course.</Text>
          )
        ) : (
          <Button label="Retake assessment" variant="secondary" fullWidth style={{ marginTop: spacing.sm }} onPress={retake} />
        )
      )}
      {submitError && <Text variant="caption" color="sell" style={{ marginTop: spacing.sm }}>{submitError}</Text>}
    </Screen>
  );
};
