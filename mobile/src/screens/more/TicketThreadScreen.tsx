import React, { useState } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Header, Input, Button } from '../../components';
import { Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { mockTickets } from '../../state/mockData';
import { USE_MOCK_DATA } from '../../api/config';

type Props = NativeStackScreenProps<MoreStackParamList, 'TicketThread'>;

export const TicketThreadScreen: React.FC<Props> = ({ route, navigation }) => {
  const { colors, spacing, radius } = useTheme();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const mockTicket = mockTickets.find((t) => t.id === route.params.id) ?? mockTickets[0];
  const q = useCloudData(() => cloud.supportTicket(route.params.id).then((r) => r.ticket), mockTicket, [route.params.id]);

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      if (!USE_MOCK_DATA) await cloud.replySupportTicket(route.params.id, reply.trim());
      setReply('');
      q.refetch();
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right', 'bottom']}>
      <Header title={route.params.subject} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {q.loading && !q.data ? (
          <View style={{ padding: spacing.md, gap: spacing.sm }}><Skeleton height={50} /><Skeleton height={50} /></View>
        ) : q.error ? (
          <View style={{ padding: spacing.md }}><ErrorState title="Couldn't load ticket" message={q.error} onAction={q.refetch} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            {q.data?.messages.map((m) => {
              const mine = m.author_type === 'customer';
              return (
                <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  <View
                    style={{
                      maxWidth: '80%',
                      backgroundColor: mine ? colors.brand : colors.card,
                      borderWidth: mine ? 0 : 1,
                      borderColor: colors.cardBorder,
                      borderRadius: radius.lg,
                      padding: spacing.sm,
                    }}
                  >
                    <Text variant="body" style={{ color: mine ? colors.brandOn : colors.textPrimary }}>{m.body}</Text>
                  </View>
                  {m.created_at && <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>{new Date(m.created_at).toLocaleString()}</Text>}
                </View>
              );
            })}
          </ScrollView>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.xs, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider }}>
          <View style={{ flex: 1 }}>
            <Input value={reply} onChangeText={setReply} placeholder="Write a reply..." />
          </View>
          <Button label="Send" onPress={sendReply} loading={sending} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
};
