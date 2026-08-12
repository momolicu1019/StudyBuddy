export type TutorMode =
  | 'explain'
  | 'hint'
  | 'test'
  | 'explain_simply'
  | 'summarize'
  | 'example'
  | 'another_way';

export type TutorModeOption = {
  id: TutorMode;
  icon: string;
  label: string;
  blurb: string;
  placeholder: string;
};

export const TUTOR_MODES: TutorModeOption[] = [
  {
    id: 'explain',
    icon: '📖',
    label: 'Explain this',
    blurb: 'Clear walkthrough of the idea or problem',
    placeholder: 'What should I explain?',
  },
  {
    id: 'hint',
    icon: '🧩',
    label: 'Give me a hint',
    blurb: 'A nudge toward the next step — not the full solution',
    placeholder: 'Where are you stuck?',
  },
  {
    id: 'test',
    icon: '🎯',
    label: 'Test me',
    blurb: 'Quiz you with a short question on the topic',
    placeholder: 'What topic should I quiz you on?',
  },
  {
    id: 'explain_simply',
    icon: '👶',
    label: 'Explain simply',
    blurb: 'Simple words, short sentences, easy examples',
    placeholder: 'What should I simplify?',
  },
  {
    id: 'summarize',
    icon: '📝',
    label: 'Summarize',
    blurb: 'Short key points you can review quickly',
    placeholder: 'What should I summarize?',
  },
  {
    id: 'example',
    icon: '💡',
    label: 'Give me an example',
    blurb: 'A concrete example that makes the idea click',
    placeholder: 'What do you want an example of?',
  },
  {
    id: 'another_way',
    icon: '🔄',
    label: 'Explain another way',
    blurb: 'A fresh angle if the first explanation did not click',
    placeholder: 'What should I re-explain differently?',
  },
];

export function tutorModeById(id: TutorMode): TutorModeOption {
  return TUTOR_MODES.find((m) => m.id === id) ?? TUTOR_MODES[0];
}

/** Extra system instructions for the selected help mode. */
export function modeInstruction(mode: TutorMode): string {
  switch (mode) {
    case 'explain':
      return (
        'Mode: Explain this. Teach the topic clearly with steps or short paragraphs. ' +
        'Cover the main idea, why it matters, and one concrete check for understanding.'
      );
    case 'hint':
      return (
        'Mode: Give me a hint. Do NOT solve the whole problem. Give one small hint or ask one guiding question. ' +
        'Stop before the final answer. If they are close, confirm the direction without finishing it for them.'
      );
    case 'test':
      return (
        'Mode: Test me. Ask one clear practice question about their topic, then wait. ' +
        'Do not reveal the answer yet. If they already answered in the message, briefly check it and ask a follow-up.'
      );
    case 'explain_simply':
      return (
        'Mode: Explain simply. Use very plain language, short sentences, and everyday analogies. ' +
        'Avoid jargon; if a term is needed, define it in one line.'
      );
    case 'summarize':
      return (
        'Mode: Summarize. Give a tight summary as 3–6 short bullet-style lines (plain text, use • ). ' +
        'No long essays. Capture only the essentials.'
      );
    case 'example':
      return (
        'Mode: Give me an example. Lead with one concrete worked example or scenario. ' +
        'Then add 1–2 lines explaining what the example shows.'
      );
    case 'another_way':
      return (
        'Mode: Explain another way. Re-teach the idea with a different analogy, structure, or angle than a standard textbook definition. ' +
        'Do not repeat the same wording as a prior reply if chat history exists.'
      );
  }
}

/**
 * Strong override: guide learning instead of handing over the answer.
 * Combines with any mode.
 */
export function guideWithoutAnswerInstruction(): string {
  return (
    'CRITICAL RULE — Don\'t give me the answer: Never give the final answer, full solution, or completed worked result. ' +
    'Guide the student with Socratic questions and tiny nudges so they learn by thinking. ' +
    'Start by asking what information they already have, then help them take the next step only. ' +
    'Example tone: "Let\'s work through it together. What information does the problem give you?" ' +
    'If they demand the answer, still refuse the full solution and offer another guiding question instead.'
  );
}

/** Modes where turning the reply into flashcards usually does not make sense. */
export function modeAllowsFlashcards(
  mode: TutorMode,
  guideWithoutAnswer: boolean,
): boolean {
  if (guideWithoutAnswer) return false;
  if (mode === 'hint' || mode === 'test') return false;
  return true;
}
