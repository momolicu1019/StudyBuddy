import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { api } from '../api/client';
import type {
  DraftFlashcard,
  GenerateDraftResponse,
  SaveFlashcardsResponse,
  Stats,
  Subject,
} from '../api/types';
import type { SourceKind } from '../storage/sourceMime';

type ToastState = { message: string; visible: boolean };

type AppContextValue = {
  subjects: Subject[];
  stats: Stats;
  loading: boolean;
  toast: ToastState;
  showToast: (message: string) => void;
  refresh: () => Promise<void>;
  createSubject: (name: string, icon: string) => Promise<Subject>;
  updateSubject: (id: number, name: string, icon: string) => Promise<void>;
  deleteSubject: (id: number) => Promise<void>;
  generateFromSource: (
    sourceType: SourceKind,
    filename: string,
    uri?: string,
  ) => Promise<GenerateDraftResponse>;
  saveDraftFlashcards: (
    subjectId: number,
    cards: DraftFlashcard[],
  ) => Promise<SaveFlashcardsResponse>;
  applySubjectUpdate: (subject: Subject) => void;
  setStats: (stats: Stats) => void;
};

const emptyStats: Stats = {
  flashcards_reviewed: 0,
  quiz_average: 0,
  focus_hours: 0,
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>({ message: '', visible: false });

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2200);
  }, []);

  const applySubjectUpdate = useCallback((subject: Subject) => {
    setSubjects((prev) => {
      const exists = prev.some((s) => s.id === subject.id);
      if (!exists) return [...prev, subject];
      return prev.map((s) => (s.id === subject.id ? subject : s));
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [subjectList, nextStats] = await Promise.all([
        api.getSubjects(),
        api.getStats(),
      ]);
      setSubjects(subjectList);
      setStats(nextStats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSubject = useCallback(
    async (name: string, icon: string) => {
      const created = await api.createSubject(name, icon);
      setSubjects((prev) => [...prev, created]);
      showToast('Folder created');
      return created;
    },
    [showToast],
  );

  const updateSubject = useCallback(
    async (id: number, name: string, icon: string) => {
      const updated = await api.updateSubject(id, name, icon);
      setSubjects((prev) => prev.map((s) => (s.id === id ? updated : s)));
      showToast('Folder renamed');
    },
    [showToast],
  );

  const deleteSubject = useCallback(
    async (id: number) => {
      const target = subjects.find((s) => s.id === id);
      await api.deleteSubject(id);
      setSubjects((prev) => prev.filter((s) => s.id !== id));
      showToast(target ? `"${target.name}" deleted` : 'Folder deleted');
    },
    [showToast, subjects],
  );

  const generateFromSource = useCallback(
    async (sourceType: SourceKind, filename: string, uri?: string) => {
      return api.generateFlashcards(sourceType, filename, uri);
    },
    [],
  );

  const saveDraftFlashcards = useCallback(
    async (subjectId: number, cards: DraftFlashcard[]) => {
      const result = await api.saveFlashcards(subjectId, cards);
      applySubjectUpdate(result.subject);
      return result;
    },
    [applySubjectUpdate],
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
      saveDraftFlashcards,
      applySubjectUpdate,
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
      saveDraftFlashcards,
      applySubjectUpdate,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
