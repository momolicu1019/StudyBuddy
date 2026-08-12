import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import {
  AppModal,
  Card,
  PrimaryButton,
  SearchInput,
} from '../components/ui';
import { useApp } from '../context/AppContext';
import type { Deadline } from '../storage/schema';
import {
  daysUntilDue,
  formatDueDate,
  getDeadlineUrgency,
  getNearestNearingUrgency,
  needsDeadlineBulb,
  sortDeadlines,
  toIsoDate,
  urgencyTone,
} from '../storage/deadlineUtils';
import { colors } from '../theme/colors';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function CalendarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const selected = useMemo(() => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }, [value]);

  const [cursor, setCursor] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const blanks = Array.from({ length: firstWeekday }, () => null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    return [...blanks, ...days];
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <View style={styles.calendar}>
      <View style={styles.calHead}>
        <Pressable
          style={styles.calNav}
          onPress={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
        >
          <Text style={styles.calNavText}>‹</Text>
        </Pressable>
        <Text style={styles.calMonth}>{monthLabel}</Text>
        <Pressable
          style={styles.calNav}
          onPress={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
        >
          <Text style={styles.calNavText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.calWeek}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.calWeekday}>
            {day}
          </Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((day, index) => {
          if (!day) {
            return <View key={`blank-${index}`} style={styles.calCell} />;
          }
          const iso = toIsoDate(new Date(cursor.getFullYear(), cursor.getMonth(), day));
          const isSelected = iso === value;
          return (
            <Pressable
              key={iso}
              style={[styles.calCell, isSelected && styles.calCellSelected]}
              onPress={() => onChange(iso)}
            >
              <Text style={[styles.calDay, isSelected && styles.calDaySelected]}>
                {day}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function DeadlinesScreen() {
  const { showToast } = useApp();
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => toIsoDate(new Date()));
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const list = await api.getDeadlines();
    setDeadlines(sortDeadlines(list));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const showBulb = needsDeadlineBulb(deadlines);
  const sectionUrgency = getNearestNearingUrgency(deadlines);
  const sectionTone = sectionUrgency ? urgencyTone(sectionUrgency) : null;
  const pendingDelete = deadlines.find((d) => d.id === deleteId) ?? null;

  async function createDeadline() {
    const trimmed = title.trim();
    if (!trimmed) {
      showToast('Please enter a deadline title');
      return;
    }
    setSaving(true);
    try {
      await api.createDeadline(trimmed, dueDate);
      setCreateOpen(false);
      setTitle('');
      setDueDate(toIsoDate(new Date()));
      showToast('Deadline added');
      await load();
    } catch (error) {
      showToast((error as Error).message || 'Could not save deadline');
    } finally {
      setSaving(false);
    }
  }

  async function markComplete(id: number) {
    try {
      await api.completeDeadline(id);
      showToast('Deadline completed');
      await load();
    } catch (error) {
      showToast((error as Error).message || 'Could not update deadline');
    }
  }

  async function confirmDelete() {
    if (deleteId === null) return;
    try {
      await api.deleteDeadline(deleteId);
      setDeleteId(null);
      showToast('Deadline deleted');
      await load();
    } catch (error) {
      showToast((error as Error).message || 'Could not delete deadline');
    }
  }

  return (
    <>
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Card
          style={[
            styles.hero,
            sectionTone
              ? {
                  borderColor: sectionTone.border,
                  backgroundColor: sectionTone.background,
                  borderWidth: 2,
                }
              : undefined,
          ]}
        >
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h1}>Deadlines and Due Date</Text>
              <Text style={[styles.sub, { marginTop: 6 }]}>
                Track assignments and exams. Entries turn amber within a week and
                red when due tomorrow or overdue — StudyBuddy can notify your
                phone for amber and red deadlines only.
              </Text>
            </View>
            {showBulb ? (
              <View
                style={[
                  styles.bulbBadge,
                  sectionTone
                    ? {
                        backgroundColor: sectionTone.background,
                        borderColor: sectionTone.border,
                      }
                    : null,
                ]}
                accessibilityLabel="Deadline reminder"
              >
                <Text style={styles.bulbText}>💡</Text>
              </View>
            ) : null}
          </View>
          {sectionTone ? (
            <Text style={[styles.bulbHint, { color: sectionTone.badge }]}>
              {sectionUrgency === 'urgent'
                ? 'You have a deadline due tomorrow or already past due.'
                : 'You have a deadline coming up within a week.'}
            </Text>
          ) : null}
          <PrimaryButton
            label="+ Add deadline"
            onPress={() => setCreateOpen(true)}
            style={{ marginTop: 16 }}
          />
        </Card>

        {deadlines.length === 0 ? (
          <Card>
            <Text style={styles.sub}>
              No deadlines yet. Add a title and due date to get started.
            </Text>
          </Card>
        ) : (
          <View style={styles.list}>
            {deadlines.map((item) => {
              const days = daysUntilDue(item.due_date);
              const urgency = getDeadlineUrgency(item.due_date);
              const tone = urgencyTone(urgency);
              return (
                <View
                  key={item.id}
                  style={[
                    styles.entry,
                    item.completed
                      ? styles.entryCompleted
                      : {
                          borderColor: tone.border,
                          backgroundColor: tone.background,
                        },
                  ]}
                >
                  <View style={styles.entryHead}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.entryTitle,
                          item.completed && styles.entryTitleDone,
                        ]}
                      >
                        {item.title}
                      </Text>
                      <Text style={styles.entryDate}>
                        Due {formatDueDate(item.due_date)}
                      </Text>
                    </View>
                    {!item.completed && days <= 1 ? (
                      <Text style={styles.entryBulb}>💡</Text>
                    ) : null}
                    <View
                      style={[
                        styles.statusChip,
                        {
                          backgroundColor: item.completed
                            ? colors.primarySoft
                            : tone.background,
                          borderColor: item.completed ? colors.primary : tone.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          {
                            color: item.completed ? colors.primary : tone.badge,
                          },
                        ]}
                      >
                        {item.completed
                          ? 'Completed'
                          : urgency === 'urgent' && days < 0
                            ? 'Past due'
                            : urgency === 'urgent' && days === 0
                              ? 'Due today'
                              : urgency === 'urgent'
                                ? 'Due tomorrow'
                                : `${days}d left`}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.entryActions}>
                    {!item.completed ? (
                      <PrimaryButton
                        label="Complete"
                        variant="secondary"
                        onPress={() => void markComplete(item.id)}
                        style={styles.actionBtn}
                      />
                    ) : (
                      <View style={[styles.actionBtn, styles.completedPill]}>
                        <Text style={styles.completedPillText}>✓ Completed</Text>
                      </View>
                    )}
                    <PrimaryButton
                      label="Delete"
                      variant="danger"
                      onPress={() => setDeleteId(item.id)}
                      style={styles.actionBtn}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <AppModal visible={createOpen} onClose={() => setCreateOpen(false)}>
        <Text style={styles.h2}>New deadline</Text>
        <Text style={[styles.sub, { marginVertical: 8 }]}>
          Give it a title and pick the due date.
        </Text>
        <SearchInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Biology midterm"
          style={styles.titleInput}
        />
        <Text style={styles.dateLabel}>Due date</Text>
        <Text style={styles.dateValue}>{formatDueDate(dueDate)}</Text>
        <CalendarPicker value={dueDate} onChange={setDueDate} />
        <View style={styles.modalActions}>
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setCreateOpen(false)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label={saving ? 'Saving…' : 'Save deadline'}
            onPress={() => void createDeadline()}
            style={{ flex: 1, opacity: saving ? 0.7 : 1 }}
          />
        </View>
      </AppModal>

      <AppModal visible={deleteId !== null} onClose={() => setDeleteId(null)}>
        <View style={{ alignItems: 'center' }}>
          <View style={styles.confirmIcon}>
            <Text style={{ fontSize: 29 }}>🗑️</Text>
          </View>
          <Text style={styles.h2}>Delete this deadline?</Text>
          <Text style={[styles.sub, { textAlign: 'center', marginTop: 8 }]}>
            Are you sure you want to delete
            {pendingDelete ? ` "${pendingDelete.title}"` : ' this deadline'}?
            This cannot be undone.
          </Text>
          <View style={styles.modalActions}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={() => setDeleteId(null)}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label="Yes, Delete"
              variant="danger"
              onPress={() => void confirmDelete()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </AppModal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 36 },
  hero: { marginBottom: 14 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  h1: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  h2: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  bulbBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulbText: { fontSize: 22 },
  bulbHint: {
    marginTop: 12,
    color: '#C9841A',
    fontWeight: '700',
    fontSize: 13,
  },
  list: { gap: 12 },
  entry: {
    borderWidth: 2,
    borderRadius: 18,
    padding: 16,
  },
  entryCompleted: {
    borderColor: colors.line,
    backgroundColor: '#F4F4F8',
    opacity: 0.92,
  },
  entryHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  entryTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
  },
  entryTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.muted,
  },
  entryDate: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  entryBulb: { fontSize: 18, marginTop: 2 },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  entryActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  actionBtn: { flex: 1 },
  completedPill: {
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  completedPillText: {
    color: colors.primary,
    fontWeight: '750' as unknown as '700',
    fontSize: 15,
  },
  titleInput: {
    marginBottom: 12,
  },
  dateLabel: {
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  dateValue: {
    color: colors.muted,
    marginBottom: 10,
    fontWeight: '600',
  },
  calendar: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    backgroundColor: colors.purpleTint,
  },
  calHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calNav: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calNavText: {
    fontSize: 22,
    color: colors.ink,
    fontWeight: '700',
    lineHeight: 24,
  },
  calMonth: {
    fontWeight: '800',
    color: colors.ink,
    fontSize: 15,
  },
  calWeek: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calWeekday: {
    flex: 1,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calCellSelected: {
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  calDay: {
    color: colors.ink,
    fontWeight: '700',
  },
  calDaySelected: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  confirmIcon: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
});
