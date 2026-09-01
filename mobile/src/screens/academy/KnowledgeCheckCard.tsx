import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Card, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { KnowledgeCheckQuestion } from '../../api/types';

interface Props {
  question: KnowledgeCheckQuestion;
}

/** Immediate, ungraded, client-side check shown inline at the end of a lesson -- not attempt-tracked like a module/final quiz. */
export const KnowledgeCheckCard: React.FC<Props> = ({ question }) => {
  const { colors, spacing, radius } = useTheme();
  const multiple = question.type === 'multi';
  const [chosen, setChosen] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);

  const toggle = (id: string) => {
    setRevealed(false);
    setChosen((old) => (multiple ? (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]) : [id]));
  };

  const correct =
    revealed &&
    chosen.length === question.correctOptionIds.length &&
    chosen.every((id) => question.correctOptionIds.includes(id));

  return (
    <Card style={{ marginTop: spacing.sm, backgroundColor: colors.brandMuted, borderColor: 'transparent' }}>
      <Text variant="micro" color="brand">KNOWLEDGE CHECK</Text>
      <Text variant="bodyMedium" style={{ marginTop: 6 }}>{question.prompt}</Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.xxs }}>
        {question.options.map((option) => {
          const active = chosen.includes(option.id);
          return (
            <Pressable
              key={option.id}
              onPress={() => toggle(option.id)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: active ? colors.brand : colors.card,
              }}
            >
              <Text variant="caption" style={{ color: active ? colors.brandOn : colors.textPrimary }}>{option.text}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => setRevealed(true)}
        disabled={!chosen.length}
        style={{
          marginTop: spacing.sm,
          paddingVertical: 8,
          borderRadius: radius.md,
          alignItems: 'center',
          backgroundColor: colors.card,
          opacity: chosen.length ? 1 : 0.5,
        }}
      >
        <Text variant="captionMedium">Check answer</Text>
      </Pressable>
      {revealed && (
        <Text variant="caption" color={correct ? 'buy' : 'sell'} style={{ marginTop: spacing.sm, lineHeight: 18 }}>
          {correct ? 'Correct. ' : 'Not quite. '}{question.explanation}
        </Text>
      )}
    </Card>
  );
};
