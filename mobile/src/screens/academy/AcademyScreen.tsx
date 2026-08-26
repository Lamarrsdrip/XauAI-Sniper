import React from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AcademyStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header } from '../../components';
import { Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockAcademyProgress } from '../../state/mockData';
import { CURRICULUM, CourseDef } from '../../state/curriculum';
import { CertificateCard } from './CertificateCard';
import { Ionicons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<AcademyStackParamList, 'Academy'>;

export const AcademyScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing, radius } = useTheme();
  const q = useCloudData(cloud.academyProgress, mockAcademyProgress, []);

  if (q.loading && !q.data) {
    return (
      <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
        <Header title="Academy" large />
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}><Skeleton height={100} /><Skeleton height={80} /><Skeleton height={80} /></View>
      </Screen>
    );
  }
  if (q.error) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']}>
        <Header title="Academy" large />
        <ErrorState title="Couldn't load Academy" message={q.error} onAction={q.refetch} />
      </Screen>
    );
  }

  const progress = q.data!;
  const completedSet = new Set(progress.completed_lesson_ids);
  const courseProgress = (course: CourseDef) => course.lessons.filter((l) => completedSet.has(l.id)).length;
  const inProgress = CURRICULUM.find((c) => {
    const done = courseProgress(c);
    return done > 0 && done < c.lessons.length;
  });

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Academy" large />
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16 }}>
          {progress.is_complete && (
            <View style={{ marginBottom: spacing.md }}>
              <CertificateCard isComplete={progress.is_complete} />
            </View>
          )}
          {inProgress && (
            <Card
              onPress={() => navigation.navigate('Lesson', { id: inProgress.lessons[courseProgress(inProgress)]?.id ?? inProgress.lessons[0].id, title: inProgress.title })}
              style={{ marginBottom: spacing.md }}
            >
              <Text variant="caption" color="secondary">CONTINUE LEARNING</Text>
              <Text variant="h2" style={{ marginTop: 4 }}>{inProgress.title}</Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.disabledBg, marginTop: spacing.sm }}>
                <View style={{ height: 6, borderRadius: 3, width: `${(courseProgress(inProgress) / inProgress.lessons.length) * 100}%`, backgroundColor: colors.brand }} />
              </View>
              <Text variant="caption" color="tertiary" style={{ marginTop: 6 }}>
                {courseProgress(inProgress)} of {inProgress.lessons.length} lessons
              </Text>
            </Card>
          )}
          <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>
            {progress.completed_count}/{progress.required_count} lessons complete · ALL COURSES
          </Text>
        </View>
        {CURRICULUM.map((course) => {
          const done = courseProgress(course);
          const allDone = done >= course.lessons.length;
          return (
            <View key={course.id} style={{ paddingHorizontal: 16, marginBottom: spacing.sm }}>
              <Card onPress={() => navigation.navigate('Lesson', { id: course.lessons[Math.min(done, course.lessons.length - 1)].id, title: course.title })}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={allDone ? 'checkmark-circle' : 'book-outline'} size={18} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">{course.title}</Text>
                    <Text variant="caption" color="secondary">{done}/{course.lessons.length} lessons</Text>
                  </View>
                </View>
              </Card>
            </View>
          );
        })}
      </View>
    </Screen>
  );
};
