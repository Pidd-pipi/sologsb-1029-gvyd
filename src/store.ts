import { computed, reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Course, ErrorCategory, Lesson, LessonProgress, PersistedState, PracticeAttempt, StudentAttemptEntry, StudentProfile, ThemeMode } from './types';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';
export const DEFAULT_STUDENT_NAME = '默认学生';

interface LegacyPersistedState {
  schemaVersion: 1;
  courses?: Course[];
  attempts?: PracticeAttempt[];
  progress?: Record<string, LessonProgress>;
  activeLessonId?: string;
  activeSentenceId?: string;
  theme?: ThemeMode;
  fontScale?: number;
  role?: 'learner' | 'teacher';
}

// Records created before profiles existed are kept under a "默认学生" profile.
function migrateLegacyState(legacy: LegacyPersistedState): PersistedState {
  const fresh = createInitialState();
  const student: StudentProfile = {
    id: 'student-default',
    name: DEFAULT_STUDENT_NAME,
    createdAt: new Date().toISOString()
  };
  return {
    ...fresh,
    courses: legacy.courses?.length ? legacy.courses : fresh.courses,
    students: [student],
    activeStudentId: student.id,
    attemptsByStudent: { [student.id]: legacy.attempts ?? [] },
    progressByStudent: { [student.id]: legacy.progress ?? {} },
    activeLessonByStudent: { [student.id]: legacy.activeLessonId ?? '' },
    activeSentenceByStudent: { [student.id]: legacy.activeSentenceId ?? '' },
    theme: legacy.theme ?? fresh.theme,
    fontScale: legacy.fontScale ?? fresh.fontScale,
    role: legacy.role ?? fresh.role
  };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState | LegacyPersistedState;
      if (parsed.schemaVersion === 2) return parsed;
      if (parsed.schemaVersion === 1) return migrateLegacyState(parsed);
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
persist();

export const activeStudent = computed(() => state.students.find((student) => student.id === state.activeStudentId));

export function addStudent(name: string): StudentProfile {
  const student: StudentProfile = {
    id: `student-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    createdAt: new Date().toISOString()
  };
  state.students.push(student);
  state.activeStudentId = student.id;
  return student;
}

export function switchStudent(studentId: string) {
  if (studentId !== state.activeStudentId && state.students.some((student) => student.id === studentId)) {
    state.activeStudentId = studentId;
  }
}

export function studentAttempts(studentId = state.activeStudentId): PracticeAttempt[] {
  return studentId ? state.attemptsByStudent[studentId] ?? [] : [];
}

export function lessonProgress(lessonId: string, studentId = state.activeStudentId): LessonProgress | undefined {
  return studentId ? state.progressByStudent[studentId]?.[lessonId] : undefined;
}

export function ensureLessonProgress(lessonId: string, firstSentenceId: string, studentId = state.activeStudentId): LessonProgress | undefined {
  if (!studentId) return undefined;
  const map = state.progressByStudent[studentId] ?? {};
  state.progressByStudent[studentId] = map;
  const progress = map[lessonId] ?? { answers: {}, activeSentenceId: firstSentenceId, updatedAt: new Date().toISOString() };
  map[lessonId] = progress;
  return progress;
}

export function getActiveLessonId(studentId = state.activeStudentId): string {
  return studentId ? state.activeLessonByStudent[studentId] ?? '' : '';
}

export function setActiveLessonId(lessonId: string, studentId = state.activeStudentId) {
  if (studentId) state.activeLessonByStudent[studentId] = lessonId;
}

export function getActiveSentenceId(studentId = state.activeStudentId): string {
  return studentId ? state.activeSentenceByStudent[studentId] ?? '' : '';
}

export function setActiveSentenceId(sentenceId: string, studentId = state.activeStudentId) {
  if (studentId) state.activeSentenceByStudent[studentId] = sentenceId;
}

export const lessons = (): Lesson[] => state.courses.flatMap((course) => course.lessons);
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string) => state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);

// Downloaded lessons stay shared: one download serves every profile on this device.
export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function saveAttempt(attempt: PracticeAttempt, studentId = state.activeStudentId) {
  if (!studentId) return;
  const attempts = state.attemptsByStudent[studentId] ?? [];
  attempts.unshift(attempt);
  state.attemptsByStudent[studentId] = attempts;
}

function findAttempt(attemptId: string): PracticeAttempt | undefined {
  for (const attempts of Object.values(state.attemptsByStudent)) {
    const found = attempts.find((attempt) => attempt.id === attemptId);
    if (found) return found;
  }
  return undefined;
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: ErrorCategory; reason?: string }) {
  const attempt = findAttempt(attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

// Feedback is written back into the bucket of the student who owns the attempt.
export function saveTeacherFeedback(attemptId: string, feedback: string): boolean {
  const attempt = findAttempt(attemptId);
  if (!attempt) return false;
  attempt.teacherFeedback = feedback;
  return true;
}

export function attemptEntries(): StudentAttemptEntry[] {
  return state.students
    .flatMap((student) => (state.attemptsByStudent[student.id] ?? []).map((attempt) => ({ student, attempt })))
    .sort((a, b) => b.attempt.submittedAt.localeCompare(a.attempt.submittedAt));
}

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    students: state.students.map((student) => ({
      studentId: student.id,
      studentName: student.name,
      attempts: state.attemptsByStudent[student.id] ?? [],
      progress: state.progressByStudent[student.id] ?? {}
    }))
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
