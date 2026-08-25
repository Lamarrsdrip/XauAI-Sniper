import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AcademyStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Header, Button } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockAcademyProgress } from '../../state/mockData';
import { findLesson, LESSONS } from '../../state/curriculum';
import { USE_MOCK_DATA } from '../../api/config';

type Props = NativeStackScreenProps<AcademyStackParamList, 'Lesson'>;

export const LessonScreen: React.FC<Props> = ({ route, navigation }) => {
  const { colors, spacing } = useTheme();
  const lesson = findLesson(route.params.id) ?? LESSONS[0];
  const index = LESSONS.findIndex((l) => l.id === lesson.id);
  const progressQ = useCloudData(cloud.academyProgress, mockAcademyProgress, []);
  const [saving, setSaving] = useState(false);

  const isComplete = !!progressQ.data?.completed_lesson_ids.includes(lesson.id);

  const toggleComplete = async () => {
    setSaving(true);
    try {
      if (USE_MOCK_DATA) {
        await new Promise((r) => setTimeout(r, 300));
      } else if (isComplete) {
        await cloud.uncompleteLesson(lesson.id);
      } else {
        await cloud.completeLesson(lesson.id);
      }
      progressQ.refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header title={lesson.title} onBack={() => navigation.goBack()} />
      <Text variant="caption" color="secondary">{lesson.level} · Lesson {index + 1} of {LESSONS.length}</Text>
      <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>{lesson.sub}</Text>

      {lesson.sections.map((section, i) => (
        <Card key={i} style={{ marginTop: spacing.sm }}>
          <Text variant="h2">{section.heading}</Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.sm, lineHeight: 22 }}>{section.body}</Text>
        </Card>
      ))}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
        <Button
          label={isComplete ? 'Completed ✓' : 'Mark Complete'}
          fullWidth
          style={{ flex: 1 }}
          loading={saving}
          variant={isComplete ? 'secondary' : 'primary'}
          onPress={toggleComplete}
        />
      </View>

      {index < LESSONS.length - 1 && (
        <Button
          label={`Next: ${LESSONS[index + 1].title}`}
          variant="ghost"
          fullWidth
          style={{ marginTop: spacing.sm }}
          onPress={() => navigation.replace('Lesson', { id: LESSONS[index + 1].id, title: LESSONS[index + 1].title })}
        />
      )}
    </Screen>
  );
};
