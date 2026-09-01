import React, { useCallback, useEffect, useMemo, useState } from "react";

const levels = ["beginner", "foundation", "intermediate", "advanced", "specialist"];
const levelLabel = (level) => String(level || "foundation").replace(/^./, (c) => c.toUpperCase());
const errText = (error, fallback) => error?.response?.data?.detail || error?.message || fallback;

/** Ordered lesson/quiz/final-assessment sequence for a course, so "Next" can jump straight to the next item without the learner going back to the course overview to find it. */
function flattenCourseItems(course) {
  const items = [];
  for (const module of course.modules) {
    for (const lesson of module.lessons) items.push({ type: "lesson", id: lesson.id, title: lesson.title, data: lesson });
    if (module.quiz) items.push({ type: "quiz", id: module.quiz.id, title: module.quiz.title, data: module.quiz });
  }
  if (course.finalAssessment) items.push({ type: "quiz", id: course.finalAssessment.id, title: course.finalAssessment.title, data: course.finalAssessment });
  return items;
}

function ProgressBar({ value = 0 }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full bg-gold-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

/** Reads a lesson's title/objectives/sections/mistakes/takeaways aloud in the same order they're displayed -- no server-side audio, no stored files, just the browser's built-in speech synthesis. */
function lessonNarrationText(lesson) {
  const parts = [`${lesson.title}.`];
  if (lesson.objectives?.length) parts.push(`Learning objectives. ${lesson.objectives.join(". ")}.`);
  for (const [heading, body] of lesson.sections) parts.push(`${heading}. ${body}`);
  if (lesson.commonMistakes?.length) parts.push(`Common mistakes. ${lesson.commonMistakes.join(". ")}.`);
  if (lesson.keyTakeaways?.length) parts.push(`Key takeaways. ${lesson.keyTakeaways.join(". ")}.`);
  return parts.join(" ");
}

function AudioLessonPlayer({ lessonId, text }) {
  const [state, setState] = useState("idle"); // idle | playing | paused
  const [rate, setRate] = useState(1);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  // A new lesson opened -- stop whatever was reading before, don't carry it over.
  useEffect(() => { if (supported) { window.speechSynthesis.cancel(); setState("idle"); } }, [lessonId, supported]);
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const speak = (atRate) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = atRate;
    utterance.onend = () => setState("idle");
    utterance.onerror = () => setState("idle");
    window.speechSynthesis.speak(utterance);
    setState("playing");
  };

  const toggle = () => {
    if (state === "playing") { window.speechSynthesis.pause(); setState("paused"); }
    else if (state === "paused") { window.speechSynthesis.resume(); setState("playing"); }
    else speak(rate);
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 0.75 : 1;
    setRate(next);
    if (state !== "idle") speak(next);
  };

  if (!supported) return null;
  return <div className="flex items-center gap-3 rounded-2xl bg-[#111218] p-4">
    <button onClick={toggle} aria-label={state === "playing" ? "Pause narration" : "Play narration"} className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gold-300 text-[14px] font-black text-black">{state === "playing" ? "⏸" : "▶"}</button>
    <div className="min-w-0 flex-1">
      <div className="text-[12px] font-bold">Listen to this lesson</div>
      <div className="mt-0.5 text-[10px] text-white/40">{state === "playing" ? "Playing…" : state === "paused" ? "Paused" : "Text-to-speech · your browser's voice"}</div>
    </div>
    <button onClick={cycleRate} className="flex-none rounded-lg bg-white/[0.08] px-2.5 py-1.5 text-[11px] font-bold text-white/75">{rate}×</button>
  </div>;
}

function KnowledgeCheck({ question }) {
  const [chosen, setChosen] = useState([]);
  const [revealed, setRevealed] = useState(false);
  const multiple = question.type === "multi";
  const toggle = (id) => setChosen((old) => multiple ? (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]) : [id]);
  const correct = revealed && chosen.length === question.correctOptionIds?.length && chosen.every((id) => question.correctOptionIds.includes(id));
  // Knowledge-check answers are intentionally included in the catalog only
  // for immediate, untracked lesson feedback. Module/final assessments stay
  // server-graded and their answers are never sent before submission.
  return <div className="mt-4 rounded-2xl border border-gold-300/15 bg-gold-300/[0.05] p-4">
    <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gold-300/70">Knowledge check</div>
    <p className="mt-2 text-[12.5px] font-semibold leading-5">{question.prompt}</p>
    <div className="mt-3 space-y-2">
      {question.options.map((option) => <button key={option.id} onClick={() => { setRevealed(false); toggle(option.id); }} className={`w-full rounded-xl px-3 py-2 text-left text-[12px] ${chosen.includes(option.id) ? "bg-gold-300 text-black" : "bg-white/[0.05] text-white/65"}`}>{option.text}</button>)}
    </div>
    <button onClick={() => setRevealed(true)} disabled={!chosen.length} className="mt-3 rounded-xl bg-white/[0.08] px-3 py-2 text-[11px] font-bold disabled:opacity-40">Check answer</button>
    {revealed && <p className={`mt-3 text-[12px] leading-5 ${correct ? "text-emerald-300" : "text-rose-300"}`}>{correct ? "Correct. " : "Not quite. "}{question.explanation}</p>}
  </div>;
}

function Quiz({ course, quiz, api, onSubmitted, nextItem, onNext }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = (question, optionId) => setAnswers((old) => {
    const previous = old[question.id] || [];
    return { ...old, [question.id]: question.type === "multi" ? (previous.includes(optionId) ? previous.filter((x) => x !== optionId) : [...previous, optionId]) : [optionId] };
  });
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await api.post(`/cloud/academy/quizzes/${encodeURIComponent(quiz.id)}/submit`, { courseId: course.id, answers });
      setResult(data); onSubmitted?.();
    } catch (error) { setError(errText(error, "Could not grade this assessment.")); } finally { setBusy(false); }
  };
  const retake = () => { setAnswers({}); setResult(null); setError(""); };
  const resultFor = (id) => result?.per_question?.find((row) => row.question_id === id);
  return <div className="space-y-4">
    <div className="rounded-2xl bg-[#111218] p-4"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gold-300/65">Server-graded assessment</div><h3 className="mt-2 text-[15px] font-black">{quiz.title}</h3><p className="mt-1 text-[11.5px] text-white/45">{quiz.questionCount} questions · {quiz.passingScorePct}% required · retakes are allowed</p></div>
    {quiz.questions.map((question, index) => {
      const grading = resultFor(question.id);
      return <div key={question.id} className="rounded-2xl bg-[#0C0D12] p-4"><div className="font-mono text-[9px] text-white/30">QUESTION {index + 1} · {String(question.type).replace(/_/g, " ")}</div><p className="mt-2 text-[13px] font-semibold leading-5">{question.prompt}</p><div className="mt-3 space-y-2">{question.options.map((option) => <button key={option.id} disabled={Boolean(result)} onClick={() => choose(question, option.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-[12px] ${answers[question.id]?.includes(option.id) ? "bg-gold-300 text-black" : "bg-white/[0.05] text-white/65"} disabled:cursor-default`}>{option.text}</button>)}</div>{grading && <div className={`mt-3 rounded-xl p-3 text-[12px] leading-5 ${grading.correct ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}><strong>{grading.correct ? "Correct" : "Incorrect"}.</strong> {grading.explanation}</div>}</div>;
    })}
    {!result ? <button onClick={submit} disabled={busy} className="w-full rounded-2xl bg-gold-300 py-3 text-[12px] font-black text-black disabled:opacity-50">{busy ? "Grading…" : "Submit assessment"}</button> : <div className={`rounded-2xl p-4 text-[13px] ${result.passed ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}><strong>{result.passed ? "Passed" : "Not passed yet"} · {result.score_pct}%</strong><div className="mt-1 text-[11.5px]">Attempt {result.attempt_number} · {result.correct_count}/{result.total_count} correct. {result.passed ? "Your progress has been saved." : "Review the explanations and retake whenever you are ready."}</div></div>}
    {result && (result.passed
      ? (nextItem ? <button onClick={() => onNext(nextItem)} className="w-full rounded-2xl bg-gold-300 py-3 text-[12px] font-black text-black">Next: {nextItem.title} →</button> : <div className="rounded-2xl bg-white/[0.05] py-3 text-center text-[12px] font-bold text-white/60">You've reached the end of this course.</div>)
      : <button onClick={retake} className="w-full rounded-2xl bg-white/[0.08] py-3 text-[12px] font-black text-white/85">Retake assessment</button>)}
    {error && <p className="text-[12px] text-rose-300">{error}</p>}
  </div>;
}

function CourseView({ course, progress, api, baseUrl, onBack, refreshProgress }) {
  const [lesson, setLesson] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [name, setName] = useState("");
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState("");
  const items = useMemo(() => flattenCourseItems(course), [course]);
  const nextAfter = (type, id) => { const idx = items.findIndex((it) => it.type === type && it.id === id); return idx >= 0 ? items[idx + 1] : undefined; };
  const goToItem = (item) => { if (!item) return; if (item.type === "lesson") { setAssessment(null); setLesson(item.data); } else { setLesson(null); setAssessment(item.data); } };
  const refreshCertificate = useCallback(async () => {
    try { const { data } = await api.get(`/cloud/academy/courses/${encodeURIComponent(course.id)}/certificate`); setCertificate(data); } catch { setCertificate(null); }
  }, [api, course.id]);
  useEffect(() => { refreshCertificate(); }, [refreshCertificate]);
  const complete = async () => { if (!lesson) return; await api.post(`/cloud/academy/courses/${encodeURIComponent(course.id)}/lessons/${encodeURIComponent(lesson.id)}/complete`); await refreshProgress(course.id); };
  const issue = async () => { setCertBusy(true); setCertError(""); try { const { data } = await api.post(`/cloud/academy/courses/${encodeURIComponent(course.id)}/certificate/confirm-name`, { name }); setCertificate({ eligible: true, issued: true, needs_name: false, certificate: data.certificate }); } catch (error) { setCertError(errText(error, "Could not issue certificate.")); } finally { setCertBusy(false); } };
  const completed = new Set(progress?.completed_lesson_ids || []);
  if (lesson) { const nxt = nextAfter("lesson", lesson.id); return <div className="space-y-4"><button onClick={() => setLesson(null)} className="text-[12px] font-semibold text-white/55">← {course.title}</button><div className="rounded-[26px] bg-[#111218] p-5"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gold-300/65">{course.title}</div><h2 className="mt-2 text-[1.4rem] font-black">{lesson.title}</h2><p className="mt-1 text-[11px] text-white/40">About {lesson.estimatedMinutes} minutes</p></div><AudioLessonPlayer lessonId={lesson.id} text={lessonNarrationText(lesson)} /><div className="rounded-2xl bg-[#0C0D12] p-4"><h3 className="text-[13px] font-bold">Learning objectives</h3><ul className="mt-2 space-y-1 text-[12px] leading-5 text-white/55">{lesson.objectives.map((item) => <li key={item}>• {item}</li>)}</ul></div>{lesson.sections.map(([heading, body]) => <div key={heading} className="rounded-2xl bg-[#0C0D12] p-4"><h3 className="text-[13px] font-bold">{heading}</h3><p className="mt-2 text-[12.5px] leading-5 text-white/55">{body}</p></div>)}<div className="rounded-2xl bg-rose-400/[0.06] p-4"><h3 className="text-[13px] font-bold text-rose-200">Common mistakes</h3><ul className="mt-2 space-y-1 text-[12px] leading-5 text-white/55">{lesson.commonMistakes.map((item) => <li key={item}>• {item}</li>)}</ul></div><div className="rounded-2xl bg-emerald-400/[0.06] p-4"><h3 className="text-[13px] font-bold text-emerald-200">Key takeaways</h3><ul className="mt-2 space-y-1 text-[12px] leading-5 text-white/55">{lesson.keyTakeaways.map((item) => <li key={item}>• {item}</li>)}</ul></div>{lesson.knowledgeCheck?.map((question) => <KnowledgeCheck key={question.id} question={question} />)}<button onClick={complete} className={`w-full rounded-2xl py-3 text-[12px] font-black ${completed.has(lesson.id) ? "bg-emerald-400/12 text-emerald-200" : "bg-gold-300 text-black"}`}>{completed.has(lesson.id) ? "Completed ✓" : "Mark lesson complete"}</button>{nxt ? <button onClick={() => goToItem(nxt)} className="w-full rounded-2xl bg-white/[0.08] py-3 text-[12px] font-black text-white/85">Next: {nxt.title} →</button> : <div className="rounded-2xl bg-white/[0.05] py-3 text-center text-[12px] font-bold text-white/60">You've reached the end of this course.</div>}</div>; }
  if (assessment) { const nxt = nextAfter("quiz", assessment.id); return <div className="space-y-4"><button onClick={() => setAssessment(null)} className="text-[12px] font-semibold text-white/55">← {course.title}</button><Quiz course={course} quiz={assessment} api={api} onSubmitted={async () => { await refreshProgress(course.id); await refreshCertificate(); }} nextItem={nxt} onNext={goToItem} /></div>; }
  return <div className="space-y-5"><button onClick={onBack} className="text-[12px] font-semibold text-white/55">← Academy home</button><div className="rounded-[26px] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.18),transparent_45%),#111218] p-5"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gold-300/65">{levelLabel(course.level)} course</div><h2 className="mt-2 text-[1.55rem] font-black">{course.title}</h2><p className="mt-2 text-[12.5px] leading-5 text-white/50">{course.summary}</p><div className="mt-4"><div className="mb-2 flex justify-between text-[10px] text-white/40"><span>Your progress</span><span>{progress?.completed_lesson_count || 0}/{progress?.total_lesson_count || 0} lessons</span></div><ProgressBar value={progress?.progress_pct || 0} /></div></div>{course.modules.map((module, index) => { const p = progress?.modules?.find((item) => item.module_id === module.id); return <div key={module.id} className="overflow-hidden rounded-2xl bg-[#0C0D12]"><div className="border-b border-white/[0.06] px-4 py-3"><div className="font-mono text-[9px] text-gold-300/60">MODULE {index + 1}</div><div className="mt-1 text-[14px] font-bold">{module.title}</div><div className="mt-1 text-[11px] text-white/40">{p?.completed_lesson_count || 0}/{module.lessons.length} lessons · {p?.quiz_passed ? "Quiz passed" : "Quiz pending"}</div></div>{module.lessons.map((item) => <button key={item.id} onClick={() => setLesson(item)} className="flex w-full items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3 text-left hover:bg-white/[0.03]"><div><div className="text-[12.5px] font-semibold">{item.title}</div><div className="mt-0.5 text-[10px] text-white/35">{item.estimatedMinutes} min · {completed.has(item.id) ? "Completed" : "Open lesson"}</div></div><span className={completed.has(item.id) ? "text-emerald-300" : "text-white/35"}>{completed.has(item.id) ? "✓" : "›"}</span></button>)}{module.quiz && <button onClick={() => setAssessment(module.quiz)} className={`w-full px-4 py-3 text-left text-[12px] font-bold ${p?.quiz_passed ? "text-emerald-300" : "text-gold-300"}`}>{p?.quiz_passed ? "✓" : "Take"} module quiz · {module.quiz.questionCount} questions</button>}</div>; })}{course.finalAssessment && <button onClick={() => setAssessment(course.finalAssessment)} className={`w-full rounded-2xl px-4 py-3 text-left text-[12px] font-black ${progress?.final_assessment_passed ? "bg-emerald-400/12 text-emerald-200" : "bg-gold-300 text-black"}`}>{progress?.final_assessment_passed ? "✓ Final assessment passed" : "Take final assessment"} · {course.finalAssessment.questionCount} questions</button>}{certificate?.issued && certificate.certificate ? <div className="rounded-2xl bg-emerald-400/[0.08] p-4"><div className="text-[13px] font-black text-emerald-200">Course certificate issued ✓</div><p className="mt-1 text-[11px] text-white/50">{certificate.certificate.recipient_name} · {certificate.certificate.certificate_id}</p><div className="mt-3 flex gap-2"><a target="_blank" rel="noreferrer" href={`${baseUrl}/cloud/academy/courses/${course.id}/certificate/view`} className="rounded-xl bg-white/[0.08] px-3 py-2 text-[11px] font-bold">View</a><a href={`${baseUrl}/cloud/academy/courses/${course.id}/certificate/download`} className="rounded-xl bg-gold-300 px-3 py-2 text-[11px] font-black text-black">Download</a></div></div> : certificate?.eligible ? <div className="rounded-2xl bg-gold-300/[0.08] p-4"><div className="text-[13px] font-black text-gold-300">Course complete — issue your certificate</div><p className="mt-1 text-[11px] text-white/50">Every lesson, module quiz and final assessment has been passed.</p><div className="mt-3 flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name for certificate" className="min-w-0 flex-1 rounded-xl bg-white/[0.07] px-3 text-[12px] outline-none"/><button onClick={issue} disabled={certBusy} className="rounded-xl bg-gold-300 px-3 py-2 text-[11px] font-black text-black">{certBusy ? "Issuing…" : "Issue"}</button></div>{certError && <p className="mt-2 text-[11px] text-rose-300">{certError}</p>}</div> : null}</div>;
}

export default function AcademyLearningHub({ api, baseUrl }) {
  const [catalog, setCatalog] = useState([]); const [progresses, setProgresses] = useState({}); const [selected, setSelected] = useState(null); const [query, setQuery] = useState(""); const [error, setError] = useState("");
  const refreshProgress = useCallback(async (courseId) => { try { const { data } = await api.get(`/cloud/academy/courses/${encodeURIComponent(courseId)}/progress`); setProgresses((old) => ({ ...old, [courseId]: data })); } catch {} }, [api]);
  useEffect(() => { let live = true; (async () => { try { const { data } = await api.get("/cloud/academy/catalog"); if (!live) return; const courses = data.courses || []; setCatalog(courses); const rows = await Promise.all(courses.map(async (course) => { try { const { data: progress } = await api.get(`/cloud/academy/courses/${encodeURIComponent(course.id)}/progress`); return [course.id, progress]; } catch { return [course.id, null]; } })); if (live) setProgresses(Object.fromEntries(rows)); } catch (error) { if (live) setError(errText(error, "Could not load the expanded Academy.")); } })(); return () => { live = false; }; }, [api]);
  const selectedCourse = catalog.find((course) => course.id === selected); const q = query.trim().toLowerCase(); const matching = catalog.filter((course) => !q || `${course.title} ${course.summary} ${course.tags.join(" ")} ${course.modules.flatMap((module) => module.lessons.map((lesson) => `${module.title} ${lesson.title} ${lesson.sections.flat().join(" ")}`)).join(" ")}`.toLowerCase().includes(q));
  const totalLessons = catalog.reduce((sum, course) => sum + course.modules.reduce((n, module) => n + module.lessons.length, 0), 0); const doneLessons = Object.values(progresses).reduce((sum, progress) => sum + Number(progress?.completed_lesson_count || 0), 0); const next = catalog.find((course) => !progresses[course.id]?.course_complete) || catalog[0];
  if (selectedCourse) return <CourseView course={selectedCourse} progress={progresses[selectedCourse.id]} api={api} baseUrl={baseUrl} onBack={() => setSelected(null)} refreshProgress={refreshProgress} />;
  return <div className="space-y-5" data-testid="academy-learning-hub"><div className="rounded-[26px] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.17),transparent_42%),#111218] p-5"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-300/65">Your learning path</div><h2 className="mt-2 text-[1.45rem] font-black">{catalog.length} courses, beginner to specialist.</h2><p className="mt-2 text-[12px] leading-5 text-white/50">Beginner → Foundation → Intermediate → Advanced → Specialist. Course progress, quizzes and certificates are saved securely to your account.</p><div className="mt-4"><div className="mb-2 flex justify-between text-[10px] text-white/40"><span>Overall Academy progress</span><span>{doneLessons}/{totalLessons} lessons</span></div><ProgressBar value={totalLessons ? Math.round((doneLessons / totalLessons) * 100) : 0} /></div></div>{next && <button onClick={() => setSelected(next.id)} className="w-full rounded-2xl bg-gold-300/[0.1] p-4 text-left"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-gold-300/70">Continue learning · Recommended next</div><div className="mt-1 text-[14px] font-black">{next.title}</div><div className="mt-1 text-[11px] text-white/45">{progresses[next.id]?.progress_pct || 0}% complete · Open course →</div></button>}<div className="rounded-2xl bg-[#0C0D12] px-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search RSI, Gold, Pips, Risk, Bitcoin, MT5, Backtesting, Psychology…" className="w-full bg-transparent py-3 text-[12px] text-white outline-none placeholder:text-white/30"/></div>{levels.map((level) => { const rows = matching.filter((course) => course.level === level); if (!rows.length) return null; return <section key={level}><div className="mb-2 px-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">{levelLabel(level)}</div><div className="space-y-2">{rows.map((course) => <button key={course.id} onClick={() => setSelected(course.id)} className="w-full rounded-2xl bg-[#0C0D12] p-4 text-left hover:bg-white/[0.04]"><div className="flex items-start justify-between gap-3"><div><div className="text-[13px] font-bold">{course.title}</div><p className="mt-1 text-[11px] leading-4 text-white/45">{course.summary}</p></div><span className="text-white/30">›</span></div><div className="mt-3 flex items-center gap-3"><div className="min-w-0 flex-1"><ProgressBar value={progresses[course.id]?.progress_pct || 0}/></div><span className="font-mono text-[9px] text-white/35">{progresses[course.id]?.progress_pct || 0}%</span></div></button>)}</div></section>; })}{error && <p className="text-[12px] text-rose-300">{error}</p>}</div>;
}
