import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { api } from '../api/client';
import type { GenerateResponse, Stats, Subject } from '../api/types';

type ToastState = { message: string; visible: boolean };

type AppContextValue = {
  subjects: Subject[];
  stats: Stats;
  loading: boolean;
  toast: ToastState;
  showToast: (message: string) => void;
  refresh: () => Promise<void>;
  createSubject: (name: string, icon: string) => Promise<void>;
  updateSubject: (id: number, name: string, icon: string) => Promise<void>;
  deleteSubject: (id: number) => Promise<void>;
  generateFromSource: (
    subjectId: number,
    sourceType: 'pdf' | 'photo',
    filename: string,
  ) => Promise<GenerateResponse>;
  setStats: (stats: Stats) => void;
};

const defaultStats: Stats = {
  flashcards_reviewed: 128,
  quiz_average: 82,
  focus_hours: 4.5,
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>({ message: '', visible: false });

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [subjectList, nextStats] = await Promise.all([
        api.getSubjects(),
        api.getStats(),
      ]);
      setSubjects(subjectList);
      setStats(nextStats);
    } catch {
      // Offline / backend not running — keep local defaults so UI still works.
      setSubjects((prev) =>
        prev.length
          ? prev
          : [
              { id: 1, name: 'Mathematics', icon: '➗', cards: 32, mastered: 24, last: 'Today' },
              { id: 2, name: 'Science', icon: '🔬', cards: 48, mastered: 36, last: 'Yesterday' },
              { id: 3, name: 'English', icon: '📖', cards: 21, mastered: 15, last: '2 days ago' },
              { id: 4, name: 'History', icon: '🌎', cards: 27, mastered: 18, last: 'Friday' },
            ],
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSubject = useCallback(
    async (name: string, icon: string) => {
      try {
        const created = await api.createSubject(name, icon);
        setSubjects((prev) => [...prev, created]);
        showToast('Subject created');
      } catch {
        const local: Subject = {
          id: Date.now(),
          name,
          icon,
          cards: 0,
          mastered: 0,
          last: 'Not studied yet',
        };
        setSubjects((prev) => [...prev, local]);
        showToast('Subject created');
      }
    },
    [showToast],
  );

  const updateSubject = useCallback(
    async (id: number, name: string, icon: string) => {
      try {
        const updated = await api.updateSubject(id, name, icon);
        setSubjects((prev) => prev.map((s) => (s.id === id ? updated : s)));
        showToast('Subject renamed');
      } catch {
        setSubjects((prev) =>
          prev.map((s) => (s.id === id ? { ...s, name, icon } : s)),
        );
        showToast('Subject renamed');
      }
    },
    [showToast],
  );

  const deleteSubject = useCallback(
    async (id: number) => {
      const target = subjects.find((s) => s.id === id);
      try {
        await api.deleteSubject(id);
      } catch {
        // local fallback
      }
      setSubjects((prev) => prev.filter((s) => s.id !== id));
      showToast(target ? `"${target.name}" deleted` : 'Folder deleted');
    },
    [showToast, subjects],
  );

  const generateFromSource = useCallback(
    async (subjectId: number, sourceType: 'pdf' | 'photo', filename: string) => {
      try {
        const result = await api.generateFlashcards(subjectId, sourceType, filename);
        setSubjects((prev) =>
          prev.map((s) => (s.id === subjectId ? result.subject : s)),
        );
        const nextStats = await api.getStats();
        setStats(nextStats);
        return result;
      } catch {
        const count = sourceType === 'photo' ? 12 : 24;
        let updatedSubject: Subject | undefined;
        setSubjects((prev) =>
          prev.map((s) => {
            if (s.id !== subjectId) return s;
            updatedSubject = {
              ...s,
              cards: s.cards + count,
              mastered: Math.min(s.cards + count, s.mastered + Math.floor(count * 0.2)),
              last: 'Just now',
            };
            return updatedSubject;
          }),
        );
        return {
          count,
          subject: updatedSubject!,
          sample_question: 'What is one key concept from the uploaded notes?',
          sample_answer:
            'The AI-generated answer will be based on the content of your PDF or note photo.',
          message: `${count} new flashcards were created from "${filename}".`,
        };
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      subjects,
      stats,
      loading,
      toast,
      showToast,
      refresh,
      createSubject,
      updateSubject,
      deleteSubject,
      generateFromSource,
      setStats,
    }),
    [
      subjects,
      stats,
      loading,
      toast,
      showToast,
      refresh,
      createSubject,
      updateSubject,
      deleteSubject,
      generateFromSource,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
