import React, { useState } from 'react';
import { View, FlatList } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button, Input, Sheet } from '../../components';
import { Skeleton, ErrorState, EmptyState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useCloudData } from '../../api/useCloudData';
import { cloud, ticketDisplayStatus } from '../../api/cloud';
import { mockTickets } from '../../state/mockData';
import { USE_MOCK_DATA } from '../../api/config';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'Support'>;

const TONE: Record<ReturnType<typeof ticketDisplayStatus>, 'info' | 'warn' | 'buy' | 'neutral'> = {
  Open: 'info',
  'Waiting for you': 'warn',
  Answered: 'buy',
  Closed: 'neutral',
};

export const SupportScreen: React.FC<Props> = ({ navigation }) => {
  const { spacing } = useTheme();
  const q = useCloudData(() => cloud.supportTickets().then((r) => r.tickets), mockTickets, []);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitTicket = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    try {
      if (!USE_MOCK_DATA) await cloud.createSupportTicket({ subject: subject.trim(), message: message.trim() });
      setSheetOpen(false);
      setSubject('');
      setMessage('');
      q.refetch();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <Header title="Support" onBack={() => goBackOrNavigate(navigation, 'More')} />
      <View style={{ paddingHorizontal: 16 }}>
        <Card style={{ marginBottom: spacing.md }}>
          <Text variant="h3">How can we help?</Text>
          <Text variant="caption" color="secondary" style={{ marginTop: 4, marginBottom: spacing.sm }}>
            Open a new ticket and our team will reply here.
          </Text>
          <Button label="New Ticket" onPress={() => setSheetOpen(true)} />
        </Card>
        <Text variant="h3" color="secondary" style={{ marginBottom: spacing.sm }}>MY TICKETS</Text>
      </View>

      {q.loading && !q.data ? (
        <View style={{ paddingHorizontal: 16, gap: spacing.sm }}><Skeleton height={70} /><Skeleton height={70} /></View>
      ) : q.error ? (
        <View style={{ paddingHorizontal: 16 }}><ErrorState title="Couldn't load tickets" message={q.error} onAction={q.refetch} /></View>
      ) : !q.data?.length ? (
        <View style={{ paddingHorizontal: 16 }}><EmptyState icon="help-buoy-outline" title="No tickets yet" message="Open one above if you need help." /></View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: spacing.sm, paddingBottom: spacing.xxxl }}
          onRefresh={q.refetch}
          refreshing={q.loading}
          renderItem={({ item }) => {
            const label = ticketDisplayStatus(item);
            return (
              <Card onPress={() => navigation.navigate('TicketThread', { id: item.id, subject: item.subject })}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>{item.subject}</Text>
                  <Badge label={label} tone={TONE[label]} />
                </View>
                <Text variant="caption" color="tertiary" style={{ marginTop: 4 }}>
                  {item.updated_at ? `Updated ${new Date(item.updated_at).toLocaleDateString()}` : ''}
                </Text>
              </Card>
            );
          }}
        />
      )}

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="New Ticket">
        <View style={{ gap: spacing.sm }}>
          <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="What's this about?" />
          <Input label="Message" value={message} onChangeText={setMessage} placeholder="Describe the issue..." multiline numberOfLines={4} style={{ height: 100, textAlignVertical: 'top' }} />
          <Button label="Send" fullWidth loading={submitting} onPress={submitTicket} />
        </View>
      </Sheet>
    </Screen>
  );
};
