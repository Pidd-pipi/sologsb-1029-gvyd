import { reactive, watch } from 'vue';
import { createInitialState, DEFAULT_STUDENT_ID, DEFAULT_STUDENT_NAME } from './data';
import type { Lesson, PersistedState, PracticeAttempt, StudentLearningState, StudentProfile } from './types';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';

interface LegacyStateV1 {
  schemaVersion: 1;
  courses: PersistedState['courses'];
  attempts: Array<Omit<PracticeAttempt, 'studentId'> & { studentId?: string }>;
  progress: Record<string, StudentLearningState['progress'][string]>;
  activeLessonId: string;
  activeSentenceId: string;
  theme: PersistedState['theme'];
  fontScale: number;
  role: PersistedState['role'];
}

// 升级前的练习记录、进度和现场全部归到“默认学生”名下。
function migrateV1(old: LegacyStateV1): PersistedState {
  return {
    schemaVersion: 2,
    courses: old.courses ?? [],
    students: [{ id: DEFAULT_STUDENT_ID, name: DEFAULT_STUDENT_NAME, createdAt: new Date().toISOString() }],
    activeStudentId: DEFAULT_STUDENT_ID,
    attempts: (old.attempts ?? []).map((attempt) => ({ ...attempt, studentId: attempt.studentId ?? DEFAULT_STUDENT_ID })),
    studentState: {
      [DEFAULT_STUDENT_ID]: {
        progress: old.progress ?? {},
        activeLessonId: old.activeLessonId ?? '',
        activeSentenceId: old.activeSentenceId ?? ''
      }
    },
    theme: old.theme ?? 'light',
    fontScale: old.fontScale ?? 1,
    role: old.role ?? 'learner'
  };
}

const emptyLearningState = (): StudentLearningState => ({ progress: {}, activeLessonId: '', activeSentenceId: '' });

function normalize(parsed: PersistedState): PersistedState {
  parsed.students = Array.isArray(parsed.students) ? parsed.students : [];
  parsed.studentState = parsed.studentState ?? {};
  parsed.attempts = (parsed.attempts ?? []).map((attempt) => ({
    ...attempt,
    studentId: attempt.studentId || parsed.students[0]?.id || DEFAULT_STUDENT_ID
  }));
  for (const student of parsed.students) {
    if (!parsed.studentState[student.id]) parsed.studentState[student.id] = emptyLearningState();
  }
  if (parsed.activeStudentId && !parsed.students.some((student) => student.id === parsed.activeStudentId)) {
    parsed.activeStudentId = parsed.students[0]?.id ?? '';
  }
  return parsed;
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState | LegacyStateV1;
      if (parsed.schemaVersion === 2) return normalize(parsed);
      if (parsed.schemaVersion === 1) return normalize(migrateV1(parsed));
    }
  } catch {
    // Falls back to the sample course when the local draft is malformed.
  }
  return createInitialState();
}

export const state = reactive<PersistedState>(loadState());

export const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

watch(state, persist, { deep: true });

export const lessons = (): Lesson[] => state.courses.flatMap((course) => course.lessons);
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string) => state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);

export const studentById = (id: string): StudentProfile | undefined => state.students.find((student) => student.id === id);
export const activeStudent = (): StudentProfile | undefined => studentById(state.activeStudentId);

export function learningStateOf(studentId: string): StudentLearningState {
  let entry = state.studentState[studentId];
  if (!entry) {
    entry = emptyLearningState();
    state.studentState[studentId] = entry;
  }
  return entry;
}

export function createStudent(name: string): StudentProfile {
  const profile: StudentProfile = {
    id: `student-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    createdAt: new Date().toISOString()
  };
  state.students.push(profile);
  learningStateOf(profile.id);
  state.activeStudentId = profile.id;
  return profile;
}

export function switchStudent(studentId: string): boolean {
  if (!studentById(studentId)) return false;
  learningStateOf(studentId);
  state.activeStudentId = studentId;
  return true;
}

export const attemptsOf = (studentId: string): PracticeAttempt[] => state.attempts.filter((attempt) => attempt.studentId === studentId);

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function saveAttempt(attempt: PracticeAttempt) {
  state.attempts.unshift(attempt);
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string }) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    students: state.students.map((student) => ({
      id: student.id,
      name: student.name,
      attempts: attemptsOf(student.id),
      progress: state.studentState[student.id]?.progress ?? {}
    }))
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
