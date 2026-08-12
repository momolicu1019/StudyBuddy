export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  Study: { subjectId: number };
  Quiz: { subjectId?: number };
  AITutor: { subject?: string };
  Flashcards: undefined;
  TypeNotes: undefined;
  Progress: undefined;
  Deadlines: undefined;
  Pomodoro: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  FlashcardsTab: undefined;
  QuizTab: undefined;
  AITutorTab: undefined;
  PomodoroTab: undefined;
};
