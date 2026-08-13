export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  Study: { subjectId: number };
  Quiz: { subjectId?: number };
  AITutor: { subject?: string };
  Flashcards: undefined;
  TypeNotes: undefined;
  Progress: undefined;
  Storage: undefined;
  Deadlines: undefined;
  Pomodoro: undefined;
  Messages: undefined;
  ChatThread: {
    conversationId: string;
    peerName: string;
    peerEmail: string;
  };
};

export type MainTabParamList = {
  Dashboard: undefined;
  FlashcardsTab: undefined;
  QuizTab: undefined;
  AITutorTab: undefined;
  PomodoroTab: undefined;
};
