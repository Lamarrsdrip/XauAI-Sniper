import React, { useState } from 'react';
import { View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { MoreStackParamList } from '../../navigation/types';
import { Screen, Text, Card, Badge, Header, Button, Input, Sheet, Toggle, Row } from '../../components';
import { Divider } from '../../components/Row';
import { LockedState, Skeleton, ErrorState } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { useAppState } from '../../state/AppState';
import { useCloudData } from '../../api/useCloudData';
import { cloud } from '../../api/cloud';
import { ApiError } from '../../api/client';
import { PropFirmConfig } from '../../api/types';
import { mockMonitorStatus, mockPropFirmConfig, mockRecentCommands } from '../../state/mockData';
import { formatDateTime } from '../../utils/format';
import { commandStatusLabel, commandStatusTone } from '../../utils/presentation';
import { goBackOrNavigate } from '../../navigation/safeBack';

type Props = NativeStackScreenProps<MoreStackParamList, 'BotControl'>;

type FieldKey = keyof Pick<PropFirmConfig, 'starting_balance' | 'daily_loss_pct' | 'max_loss_pct' | 'safety_buffer_pct' | 'risk_per_trade_pct' | 'max_basket_risk_pct' | 'retest_add_lot_multi'>;

const FIELD_META: Record<FieldKey, { label: string; help: string; suffix: string }> = {
  starting_balance: { label: 'Starting balance', help: 'The account size your prop firm loss limits are measured against.', suffix: '' },
  daily_loss_pct: { label: 'Daily loss limit', help: 'Max % the account may lose in a single day before protection engages (0.5–20%).', suffix: '%' },
  max_loss_pct: { label: 'Total drawdown limit', help: 'Max % the account may lose overall before protection engages (0.5–30%).', suffix: '%' },
  safety_buffer_pct: { label: 'Safety buffer', help: 'Extra room kept below the daily limit so trading stops before the hard limit is touched.', suffix: '%' },
  risk_per_trade_pct: { label: 'Risk per trade', help: 'Max % of the account risked on a single trade (0.01–2%).', suffix: '%' },
  max_basket_risk_pct: { label: 'Max basket risk', help: 'Max % of the account risked across all open trades at once (0.01–4%).', suffix: '%' },
  retest_add_lot_multi: { label: 'Retest add-on size', help: 'Lot size multiplier used if XauCloud adds to a position on a confirmed retest (5–50%).', suffix: '×' },
};

export const BotControlScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, spacing } = useTheme();
  const { entitlement, license } = useAppState();
  const owns = Boolean(entitlement?.bot_license);
  const pin = license?.license?.activation_key ?? '';

  const monitorQ = useCloudData(cloud.monitorStatus, mockMonitorStatus, [owns]);
  const commandsQ = useCloudData(cloud.recentCommands, mockRecentCommands, [owns]);
  const propFirmQ = useCloudData(cloud.propFirmConfig, mockPropFirmConfig, [owns]);

  const [confirmAction, setConfirmAction] = useState<'PAUSE_NEW_TRADES' | 'RESUME_TRADING' | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [draft, setDraft] = useState<PropFirmConfig | null>(null);
  const [editingField, setEditingField] = useState<FieldKey | null>(null);
  const [editingDraftValue, setEditingDraftValue] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  if (!owns) {
    return (
      <Screen>
        <Header title="Bot Control" onBack={() => goBackOrNavigate(navigation, 'More')} />
        <LockedState
          title="Bot Control is a Bot feature"
          message="Get XauCloud Bot to turn automated trading on or off and set Prop Firm Protection."
          onUpgrade={() => navigation.navigate('Billing')}
        />
      </Screen>
    );
  }

  const refetchAll = () => { monitorQ.refetch(); commandsQ.refetch(); propFirmQ.refetch(); };

  if ((monitorQ.loading && !monitorQ.data) || (propFirmQ.loading && !propFirmQ.data)) {
    return (
      <Screen>
        <Header title="Bot Control" onBack={() => goBackOrNavigate(navigation, 'More')} />
        <Skeleton height={140} />
        <Skeleton height={260} style={{ marginTop: spacing.md }} />
      </Screen>
    );
  }
  if (monitorQ.error && !monitorQ.data) {
    return (
      <Screen>
        <Header title="Bot Control" onBack={() => goBackOrNavigate(navigation, 'More')} />
        <ErrorState title="Couldn't load Bot Control" message={monitorQ.error} onAction={refetchAll} />
      </Screen>
    );
  }

  const monitor = monitorQ.data;
  const heartbeat = monitor?.heartbeat;
  const online = !!monitor && !monitor.offline;
  const openTrades = online ? Number(heartbeat?.open_positions ?? 0) : 0;
  const commands = commandsQ.data?.commands ?? [];

  // Never trust a local "I just tapped it" flag for the running/paused
  // label -- only the EA's own acknowledged state (bot_state) or a still-
  // pending/acked command in the recent list may say so. See section 4 of
  // the audit spec: "Do not fake immediate state changes."
  const rawState = String(heartbeat?.bot_state ?? '').toUpperCase();
  const paused = rawState.includes('PAUSE') || rawState.includes('STOP');
  const pendingToggle = commands.find((c) => (c.action === 'PAUSE_NEW_TRADES' || c.action === 'RESUME_TRADING') && (c.status === 'PENDING' || c.status === 'ACKED'));
  const turningTo = pendingToggle ? (pendingToggle.action === 'RESUME_TRADING' ? 'on' : 'off') : null;

  let stateLabel: string; let running: boolean; let stateTone: 'buy' | 'warn' | 'neutral';
  if (!online) { stateLabel = 'EA offline'; running = false; stateTone = 'neutral'; }
  else if (turningTo === 'off') { stateLabel = 'Pausing…'; running = false; stateTone = 'warn'; }
  else if (turningTo === 'on') { stateLabel = 'Resuming…'; running = true; stateTone = 'buy'; }
  else if (paused) { stateLabel = 'Paused'; running = false; stateTone = 'warn'; }
  else { stateLabel = 'Running'; running = true; stateTone = 'buy'; }

  const toggleDisabled = !online || !pin || Boolean(turningTo) || sending;

  const sendToggle = async (action: 'PAUSE_NEW_TRADES' | 'RESUME_TRADING') => {
    setSending(true);
    setSendError(null);
    try {
      await cloud.requestBotCommand(action, pin);
      setConfirmAction(null);
      refetchAll();
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : 'Could not send that command. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const propFirm = propFirmQ.data;
  const applied = propFirm?.applied ?? mockPropFirmConfig.applied;
  const working = draft ?? propFirm?.requested ?? applied;
  const setWorking = (patch: Partial<PropFirmConfig>) => setDraft({ ...working, ...patch });
  const isDirty = draft != null;

  const openFieldEditor = (key: FieldKey) => {
    setEditingField(key);
    setEditingDraftValue(String(working[key] ?? ''));
  };
  const saveFieldEditor = () => {
    if (!editingField) return;
    const n = Number(editingDraftValue);
    if (Number.isFinite(n)) setWorking({ [editingField]: n } as Partial<PropFirmConfig>);
    setEditingField(null);
  };

  const applyPropFirm = async () => {
    if (!draft || !pin) return;
    setApplying(true);
    setApplyError(null);
    try {
      await cloud.applyPropFirmConfig(pin, draft);
      setDraft(null);
      refetchAll();
    } catch (e) {
      setApplyError(e instanceof ApiError ? e.message : 'Could not send your Prop Firm settings to the EA. Please try again.');
    } finally {
      setApplying(false);
    }
  };

  const ackTone = commandStatusTone(propFirm?.apply_status);
  const ackLabel = propFirm?.apply_status === 'NOT_LINKED' ? 'Link a license first' : propFirm?.apply_status === 'NOT_CONFIGURED' ? 'Not configured yet' : commandStatusLabel(propFirm?.apply_status);

  const FieldRow: React.FC<{ k: FieldKey }> = ({ k }) => (
    <>
      <Row
        title={FIELD_META[k].label}
        subtitle={FIELD_META[k].help}
        right={<Text variant="bodyMedium">{working[k]}{FIELD_META[k].suffix}</Text>}
        showChevron
        onPress={() => openFieldEditor(k)}
      />
      <Divider inset />
    </>
  );

  return (
    <Screen onRefresh={refetchAll} refreshing={monitorQ.loading || propFirmQ.loading}>
      <Header title="Bot Control" onBack={() => goBackOrNavigate(navigation, 'More')} />
      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.md }}>
        Turn automated trading on or off, and set your Prop Firm Protection limits. Every change here is sent to your connected EA — nothing changes until it acknowledges.
      </Text>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: running ? colors.buyBg : online ? colors.brandMuted : colors.disabledBg }}>
            <Ionicons name="hardware-chip-outline" size={19} color={running ? colors.buy : online ? colors.brand : colors.textTertiary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium">Trading Bot · {stateLabel}</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
              {running ? 'Opening valid trades automatically' : online ? 'New entries paused — open trades protected' : 'Waiting for EA heartbeat'}
            </Text>
          </View>
          <Toggle value={running} disabled={toggleDisabled} onChange={(next) => setConfirmAction(next ? 'RESUME_TRADING' : 'PAUSE_NEW_TRADES')} />
        </View>
      </Card>
      <Text variant="caption" color="tertiary" style={{ marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 17 }}>
        Bot <Text variant="captionMedium" color="tertiary">OFF</Text> stops new automatic entries — {openTrades > 0 ? `your ${openTrades} open position${openTrades === 1 ? '' : 's'} stay` : 'any open position stays'} protected and managed. Bot <Text variant="captionMedium" color="tertiary">ON</Text> resumes normal entries after the EA acknowledges.
      </Text>

      <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.2, marginBottom: spacing.sm }}>PROP FIRM PROTECTION</Text>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text variant="bodyMedium">Protection enabled</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>Applied: {applied.enabled ? 'ON' : 'OFF'}</Text>
          </View>
          <Toggle value={Boolean(working.enabled)} onChange={(next) => setWorking({ enabled: next })} />
        </View>
      </Card>
      <Card padded={false} style={{ marginTop: spacing.sm }}>
        <View style={{ paddingHorizontal: spacing.md }}>
          <FieldRow k="starting_balance" />
          <FieldRow k="daily_loss_pct" />
          <FieldRow k="max_loss_pct" />
          <FieldRow k="safety_buffer_pct" />
          <FieldRow k="risk_per_trade_pct" />
          <FieldRow k="max_basket_risk_pct" />
          <Row
            title="Allow retest add-on"
            subtitle="Let XauCloud add to a winning position on a confirmed retest"
            right={<Toggle value={Boolean(working.allow_retest_add)} onChange={(next) => setWorking({ allow_retest_add: next })} />}
          />
          {working.allow_retest_add && <><Divider inset /><FieldRow k="retest_add_lot_multi" /></>}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
        <Badge label={ackLabel} tone={ackTone} dot />
        {propFirm?.apply_message ? <Text variant="caption" color="secondary" style={{ flexShrink: 1 }}>{propFirm.apply_message}</Text> : null}
      </View>
      {applyError ? <Text variant="caption" color="sell" style={{ marginTop: spacing.xs }}>{applyError}</Text> : null}

      {isDirty && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label="Discard changes" variant="ghost" style={{ flex: 1 }} fullWidth onPress={() => setDraft(null)} />
          <Button label="Apply to EA" style={{ flex: 1 }} fullWidth loading={applying} onPress={applyPropFirm} />
        </View>
      )}

      {commands.length > 0 && (
        <>
          <Text variant="micro" color="tertiary" style={{ letterSpacing: 1.2, marginTop: spacing.xl, marginBottom: spacing.sm }}>RECENT COMMANDS</Text>
          <Card padded={false}>
            <View style={{ paddingHorizontal: spacing.md }}>
              {commands.slice(0, 8).map((cmd, index) => (
                <React.Fragment key={cmd.id}>
                  <Row
                    title={cmd.label || cmd.action}
                    subtitle={`${formatDateTime(cmd.requested_at)}${cmd.ack_message ? ` · ${cmd.ack_message}` : ''}`}
                    right={<Badge label={commandStatusLabel(cmd.status)} tone={commandStatusTone(cmd.status)} />}
                  />
                  {index < Math.min(commands.length, 8) - 1 && <Divider inset />}
                </React.Fragment>
              ))}
            </View>
          </Card>
        </>
      )}

      <Sheet visible={confirmAction != null} onClose={() => (sending ? null : setConfirmAction(null))} title={confirmAction === 'RESUME_TRADING' ? 'Turn Bot On?' : 'Turn Bot Off?'}>
        <View style={{ gap: spacing.sm }}>
          <Text variant="body" color="secondary">
            {confirmAction === 'RESUME_TRADING'
              ? 'New valid trades may open again using the normal evidence engine, owner blockers and risk rules. Turning on never forces an immediate trade.'
              : openTrades > 0
              ? `New automatic entries will stop. Your ${openTrades} open position${openTrades === 1 ? '' : 's'} stay protected and managed — stop-loss, profit floor and runner logic keep running until they close naturally.`
              : 'New automatic entries will stop. The EA keeps its heartbeat and will still manage any position that opens before it acknowledges.'}
          </Text>
          {sendError ? <Text variant="caption" color="sell">{sendError}</Text> : null}
          <Button label={confirmAction === 'RESUME_TRADING' ? 'Turn Bot On' : 'Turn Bot Off'} fullWidth loading={sending} onPress={() => confirmAction && sendToggle(confirmAction)} />
          <Button label="Cancel" variant="ghost" fullWidth onPress={() => setConfirmAction(null)} disabled={sending} />
        </View>
      </Sheet>

      <Sheet visible={editingField != null} onClose={() => setEditingField(null)} title={editingField ? FIELD_META[editingField].label : undefined}>
        {editingField && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" color="secondary">{FIELD_META[editingField].help}</Text>
            <Input value={editingDraftValue} onChangeText={setEditingDraftValue} keyboardType="decimal-pad" autoFocus />
            <Button label="Save" fullWidth onPress={saveFieldEditor} />
          </View>
        )}
      </Sheet>
    </Screen>
  );
};
