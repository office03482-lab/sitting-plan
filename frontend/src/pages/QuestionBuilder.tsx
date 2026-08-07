import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  History,
  Image as ImageIcon,
  Plus,
  Save,
  Search,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { OnlineTest } from '@types';
import {
  createEmptyQuestionDraft,
  mapQuestionToDraft,
  questionDraftToPayload,
  type QuestionDraft,
} from '@pages/onlineTestsShared';

import TaxonomySelect from './questionBank/TaxonomySelect';
import FormulaPanel from './questionBank/FormulaPanel';
import AIGenerator from './questionBank/AIGenerator';
import OCRPanel from './questionBank/OCRPanel';
import PDFImportPanel from './questionBank/PDFImportPanel';
import VersionHistory from './questionBank/VersionHistory';

import type { ExamType } from './questionBank/taxonomyData';
import {
  EXAM_TYPES,
  QUESTION_TYPES,
  DIFFICULTY_LEVELS,
  QUESTION_SOURCES,
  QUESTION_TAGS,
  LANGUAGES,
  getSubjectsForExam,
  getChaptersForSubject,
  getTopicsForChapter,
} from './questionBank/taxonomyData';

type ActiveTool = 'ai' | 'ocr' | 'pdf' | 'formula' | 'history' | null;
type RightPanelView = 'tools' | 'preview';

const sf = 'w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-100';
const sl = 'mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500';
const sselect = `${sf} cursor-pointer appearance-none`;
const EXAM_TYPE_IDS = new Set<ExamType>(EXAM_TYPES.map((item) => item.id));

function parseExamType(value: unknown): ExamType | null {
  const normalized = typeof value === 'string' ? value : '';
  return EXAM_TYPE_IDS.has(normalized as ExamType) ? (normalized as ExamType) : null;
}

export default function QuestionBuilder() {
  const { id: testId, questionId: bankQuestionId } = useParams<{ id: string; questionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as {
    banner?: { type: 'success' | 'error' | 'warning' | 'info'; message: string };
    tool?: ActiveTool;
  } | null;
  const { authReady, sessionReady, schoolContextReady } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady;

  const [test, setTest] = useState<OnlineTest | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([createEmptyQuestionDraft(1)]);
  const [removedQuestionIds, setRemovedQuestionIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pageError, setPageError] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);
  const [uploadingAssetKey, setUploadingAssetKey] = useState('');
  const [assetUploadProgress, setAssetUploadProgress] = useState<Record<string, number>>({});

  // Extended metadata (stored in metadata JSONB via existing API)
  const [examType, setExamType] = useState<ExamType>('custom');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [subTopic, setSubTopic] = useState('');
  const [estimatedTime, setEstimatedTime] = useState('120');
  const [sourceId, setSourceId] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [language, setLanguage] = useState('en');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('private');
  const [questionCode, setQuestionCode] = useState('');
  const [questionStatus, setQuestionStatus] = useState('draft');

  // Panel state
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [rightView, setRightView] = useState<RightPanelView>('preview');
  const [showFormulaPanel, setShowFormulaPanel] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [versions] = useState<Array<{ id: string; version: number; created_at: string; change_summary?: string }>>([]);

  // State banner from navigation
  useEffect(() => {
    if (navigationState?.banner) {
      setBanner(navigationState.banner);
    }
    if (navigationState?.tool) {
      setActiveTool(navigationState.tool);
      setRightView('tools');
      setShowFormulaPanel(navigationState.tool === 'formula');
    }
    if (navigationState?.banner || navigationState?.tool) window.history.replaceState({}, '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canRunRequests) return;
    if (testId) {
      void loadTestData(testId);
    } else if (bankQuestionId) {
      void loadBankQuestion(bankQuestionId);
    } else {
      setLoading(false);
    }
  }, [canRunRequests, testId, bankQuestionId]);

  const loadTestData = async (id: string) => {
    try {
      setLoading(true);
      setPageError('');
      const [testResponse, questionResponse] = await Promise.all([
        apiService.getOnlineTest(id),
        apiService.listOnlineTestQuestions({ test_id: id }),
      ]);
      setTest(testResponse.data);
      const questions = questionResponse.data || [];
      setQuestionDrafts(questions.length ? questions.map((q) => mapQuestionToDraft(q)) : [createEmptyQuestionDraft(1)]);
    } catch (error) {
      setPageError(getRequestErrorMessage(error, 'Question builder load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const loadBankQuestion = async (id: string) => {
    try {
      setLoading(true);
      setPageError('');
      const response = await apiService.getQBQuestion(id);
      const q = response.data as Record<string, unknown>;
      const options = (q.option_items as Array<{ label?: string; value?: string }> || []);
      const meta = (q.metadata || {}) as Record<string, unknown>;
      const draft: QuestionDraft = {
        ...createEmptyQuestionDraft(1),
        id,
        display_order: '1',
        question_type: typeof q.question_type === 'string' ? q.question_type : 'single_choice',
        prompt_text: typeof q.prompt_text === 'string' ? q.prompt_text : '',
        option_lines: options.map((o) => o.label || o.value || '').join('\n'),
        answer_lines: (() => {
          const ak = q.answer_key as Record<string, unknown> | undefined;
          if (typeof ak?.correct_option_id === 'string') return ak.correct_option_id;
          if (Array.isArray(ak?.correct_option_ids)) {
            return ak.correct_option_ids.filter((item): item is string => typeof item === 'string').join(',');
          }
          return '';
        })(),
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
        marks: String(q.marks || 1),
        negative_marks: String(q.negative_marks || 0),
        difficulty_level: typeof q.difficulty_level === 'string' ? q.difficulty_level : 'medium',
        subject: typeof q.subject === 'string' ? q.subject : '',
        chapter: typeof q.chapter === 'string' ? q.chapter : '',
        topic: typeof q.topic === 'string' ? q.topic : '',
        question_code: typeof meta.question_code === 'string' ? meta.question_code : '',
      };
      setQuestionDrafts([draft]);
      setCurrentIndex(0);
      const resolvedExamType = parseExamType(q.exam_type_slug);
      if (resolvedExamType) setExamType(resolvedExamType);
      if (q.language) setLanguage(q.language as string);
      if (meta.source_name) setSourceName(meta.source_name as string);
      if (Array.isArray(meta.tags)) setSelectedTags(meta.tags as string[]);
      if (q.status) setQuestionStatus(q.status as string);
    } catch (error) {
      setPageError(getRequestErrorMessage(error, 'Bank question load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const currentDraft = questionDrafts[currentIndex] || questionDrafts[0];
  const questionCount = questionDrafts.filter((d) => d.prompt_text.trim()).length;
  const totalMarks = useMemo(() => questionDrafts.reduce((sum, d) => sum + Number(d.marks || 0), 0), [questionDrafts]);

  // Cascading taxonomy
  const availableSubjects = useMemo(() => getSubjectsForExam(examType), [examType]);
  const availableChapters = useMemo(() => getChaptersForSubject(examType, subjectFilter), [examType, subjectFilter]);
  const availableTopics = useMemo(() => getTopicsForChapter(examType, subjectFilter, chapterFilter), [examType, subjectFilter, chapterFilter]);

  // Handlers
  const updateQuestion = useCallback((index: number, field: keyof QuestionDraft, value: string) => {
    setQuestionDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, [field]: value } : draft)));
  }, []);

  const updateCurrentField = useCallback((field: keyof QuestionDraft, value: string) => {
    updateQuestion(currentIndex, field, value);
  }, [currentIndex, updateQuestion]);

  const addQuestion = useCallback(() => {
    setQuestionDrafts((current) => [...current, createEmptyQuestionDraft(current.length + 1)]);
    setCurrentIndex(questionDrafts.length);
  }, [questionDrafts.length]);

  const removeQuestion = useCallback((index: number) => {
    setQuestionDrafts((current) => {
      const target = current[index];
      if (target?.id) setRemovedQuestionIds((existing) => [...existing, target.id as string]);
      const next = current.filter((_, i) => i !== index);
      return next.length ? next : [createEmptyQuestionDraft(1)];
    });
    setCurrentIndex((prev) => Math.max(0, Math.min(prev, questionDrafts.length - 2)));
  }, [questionDrafts.length]);

  const duplicateCurrent = useCallback(() => {
    if (!currentDraft) return;
    const clone: QuestionDraft = { ...currentDraft, id: undefined, display_order: String(questionDrafts.length + 1) };
    setQuestionDrafts((prev) => [...prev, clone]);
    setCurrentIndex(questionDrafts.length);
  }, [currentDraft, questionDrafts.length]);

  const trackAssetProgress = useCallback((key: string) => (e: { loaded?: number; total?: number }) => {
    const total = Number(e.total || 0);
    const loaded = Number(e.loaded || 0);
    if (!total) return;
    setAssetUploadProgress((c) => ({ ...c, [key]: Math.round((loaded / total) * 100) }));
  }, []);

  const handleQuestionImageUpload = useCallback(async (index: number, file: File) => {
    const key = `q-img-${index}`;
    try {
      setUploadingAssetKey(key);
      const response = await apiService.uploadImage(file, { purpose: 'online_test_question', onUploadProgress: trackAssetProgress(key) });
      updateQuestion(index, 'question_image_url', response.data.url);
      setBanner({ type: 'success', message: 'Image uploaded.' });
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Upload failed.') });
    } finally { setUploadingAssetKey(''); }
  }, [updateQuestion, trackAssetProgress]);

  const handleOptionImageUpload = useCallback(async (questionIndex: number, optionIndex: number, file: File) => {
    const key = `opt-img-${questionIndex}-${optionIndex}`;
    try {
      setUploadingAssetKey(key);
      const response = await apiService.uploadImage(file, { purpose: 'online_test_option', onUploadProgress: trackAssetProgress(key) });
      const lines = (questionDrafts[questionIndex]?.option_lines || '').split('\n');
      while (lines.length <= optionIndex) lines.push('');
      const currentLine = lines[optionIndex]?.split('|')[0]?.trim() || `Option ${String.fromCharCode(65 + optionIndex)}`;
      lines[optionIndex] = `${currentLine} | ${response.data.url}`;
      updateQuestion(questionIndex, 'option_lines', lines.join('\n'));
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Upload failed.') });
    } finally { setUploadingAssetKey(''); }
  }, [questionDrafts, updateQuestion, trackAssetProgress]);

  const saveQuestions = async (showBanner = true) => {
    try {
      setSaving(true);
      setBanner(null);
      const validQuestions = questionDrafts.filter((d) => d.prompt_text.trim());
      if (!validQuestions.length) {
        if (showBanner) setBanner({ type: 'warning', message: 'No questions to save.' });
        return false;
      }

      if (testId) {
        // TEST CONTEXT: save via online test question APIs
        for (const qid of removedQuestionIds) await apiService.deleteOnlineTestQuestion(qid);
        setRemovedQuestionIds([]);
        for (const question of validQuestions) {
          const payload = questionDraftToPayload(question, testId);
          if (question.id) {
            await apiService.updateOnlineTestQuestion(question.id, payload);
          } else {
            const created = await apiService.createOnlineTestQuestion(payload);
            setQuestionDrafts((prev) => prev.map((d) => (d === question ? { ...d, id: created.data.id } : d)));
          }
        }
      } else {
        // STANDALONE CONTEXT: save via shared question bank APIs
        for (const question of validQuestions) {
          const bankPayload = {
            question_type: question.question_type,
            difficulty_level: question.difficulty_level,
            prompt_text: question.prompt_text,
            option_items: question.option_lines.split('\n').filter(Boolean).map((line, i) => {
              const [label, imageUrl] = line.split('|').map((s) => s.trim());
              return { id: `option_${i + 1}`, label, value: label, ...(imageUrl ? { image_url: imageUrl } : {}) };
            }),
            answer_key: { correct_option_id: question.answer_lines.trim() },
            explanation: question.explanation || undefined,
            marks: Number(question.marks || 1),
            negative_marks: Number(question.negative_marks || 0),
            subject: question.subject || undefined,
            chapter: question.chapter || undefined,
            topic: question.topic || undefined,
            exam_type_slug: examType,
            status: questionStatus,
            display_order: Number(question.display_order || 1),
            language,
            metadata: {
              estimated_time_seconds: Number(estimatedTime),
              source_name: sourceName || undefined,
              tags: selectedTags,
              visibility,
              question_code: question.question_code || questionCode || undefined,
            },
          };
          if (question.id) {
            await apiService.updateQBQuestion(question.id, bankPayload);
          } else {
            const created = await apiService.createQBQuestion(bankPayload);
            setQuestionDrafts((prev) => prev.map((d) => (d === question ? { ...d, id: created.data.id as string } : d)));
          }
        }
      }

      if (showBanner) setBanner({ type: 'success', message: 'Questions saved successfully.' });
      return true;
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Save failed.') });
      return false;
    } finally { setSaving(false); }
  };

  const handleSaveAndNext = async () => {
    if (!currentDraft?.prompt_text.trim()) {
      setBanner({ type: 'error', message: 'Question prompt is required.' });
      return;
    }
    const ok = await saveQuestions(false);
    if (ok) {
      if (currentIndex >= questionDrafts.length - 1) addQuestion();
      else setCurrentIndex((prev) => prev + 1);
      setBanner({ type: 'success', message: 'Saved. Next question ready.' });
    }
  };

  const handlePublish = async () => {
    try {
      setPublishing(true);
      setBanner(null);
      const ok = await saveQuestions(false);
      if (!ok) return;
      if (testId) {
        await apiService.publishOnlineTest(testId);
      }
      setBanner({ type: 'success', message: testId ? 'Test published!' : 'Questions published to bank!' });
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Publish failed.') });
    } finally { setPublishing(false); }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) => prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]);
  };

  const insertFormula = (formula: string) => {
    updateCurrentField('prompt_text', (currentDraft?.prompt_text || '') + formula);
  };

  const handleAIGenerated = (questions: Array<{ prompt: string; options: string[]; answer: string; explanation: string }>) => {
    for (const q of questions) {
      const draft = createEmptyQuestionDraft(questionDrafts.length + 1);
      draft.prompt_text = q.prompt;
      draft.option_lines = q.options.join('\n');
      draft.answer_lines = q.answer;
      draft.explanation = q.explanation;
      setQuestionDrafts((prev) => [...prev, draft]);
    }
    setBanner({ type: 'success', message: `${questions.length} AI questions added.` });
  };

  const handleOCRImport = (data: { prompt: string; options: string[]; answer: string; explanation: string }) => {
    updateCurrentField('prompt_text', data.prompt);
    updateCurrentField('option_lines', data.options.join('\n'));
    updateCurrentField('answer_lines', data.answer);
    if (data.explanation) updateCurrentField('explanation', data.explanation);
    setBanner({ type: 'success', message: 'OCR content imported into current question.' });
  };

  const handlePDFImport = (questions: Array<{ prompt: string; options: string[]; answer: string; explanation: string }>) => {
    for (const q of questions) {
      const draft = createEmptyQuestionDraft(questionDrafts.length + 1);
      draft.prompt_text = q.prompt;
      draft.option_lines = q.options.join('\n');
      draft.answer_lines = q.answer;
      draft.explanation = q.explanation;
      setQuestionDrafts((prev) => [...prev, draft]);
    }
    setBanner({ type: 'success', message: `${questions.length} questions imported from PDF.` });
  };

  // ────────── Loading/Error states ──────────
  if (loading) return <LoadingSpinner message="Loading question builder..." />;
  if (pageError) return <div className="p-4 md:p-6"><Alert type="error" message={pageError} /></div>;

  const hasChoiceType = ['single_choice', 'multiple_choice'].includes(currentDraft?.question_type || '');

  // Filtered question list for search
  const filteredDrafts = searchQuery
    ? questionDrafts.filter((d) => d.prompt_text.toLowerCase().includes(searchQuery.toLowerCase()) || d.subject.toLowerCase().includes(searchQuery.toLowerCase()))
    : questionDrafts;

  return (
    <div className="flex h-screen flex-col bg-slate-50">

      {/* ════════════ TOP BAR ════════════ */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(testId ? `/online-tests/edit/${testId}` : '/question-bank')} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <div>
            <h1 className="text-[13px] font-bold text-slate-900 leading-tight">{testId ? (test?.title || 'Test Questions') : bankQuestionId ? 'Question Bank — Edit' : 'Question Bank — New Question'}</h1>
            <p className="text-[10px] text-slate-400">{questionCount} questions · {totalMarks} marks{testId ? '' : ' · Shared Bank'}</p>
          </div>
        </div>

        {/* Question Tabs */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCurrentIndex((p) => Math.max(0, p - 1))} disabled={currentIndex === 0} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="flex max-w-[400px] gap-0.5 overflow-x-auto">
            {questionDrafts.map((draft, idx) => (
              <button key={draft.id || `t-${idx}`} type="button" onClick={() => setCurrentIndex(idx)}
                className={`flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-bold transition ${idx === currentIndex ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                {idx + 1}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setCurrentIndex((p) => Math.min(questionDrafts.length - 1, p + 1))} disabled={currentIndex >= questionDrafts.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={addQuestion} className="ml-1 inline-flex h-7 items-center gap-0.5 rounded-md border border-dashed border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-500 hover:border-blue-400 hover:text-blue-600">
            <Plus className="h-3 w-3" /> Add
          </button>
          <button type="button" onClick={() => setShowSearch(!showSearch)} className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-200">
            {(['preview', 'tools'] as RightPanelView[]).map((v) => (
              <button key={v} type="button" onClick={() => setRightView(v)}
                className={`px-2.5 py-1 text-[10px] font-semibold capitalize ${rightView === v ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Search Bar */}
      {showSearch && (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search questions by text, subject, chapter..." className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-slate-400" />
          {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600"><X className="h-3 w-3" /></button>}
          <span className="text-[10px] text-slate-400">{filteredDrafts.length} results</span>
        </div>
      )}

      {banner ? <div className="shrink-0 px-4 pt-1.5"><Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /></div> : null}

      {/* ════════════ MAIN 3-COLUMN ════════════ */}
      <div className="flex min-h-0 flex-1">

        {/* ──────── LEFT PANEL: Metadata ──────── */}
        <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Question Metadata</h3>
              <div className="flex items-center gap-1.5">
                {currentDraft?.id ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">SAVED</span>
                ) : (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">DRAFT</span>
                )}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">v{currentDraft?.id ? 2 : 1}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            {/* Exam & Taxonomy */}
            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 space-y-2.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Exam & Taxonomy</h4>
              <div>
                <label className={sl}>Exam Type</label>
                <select value={examType} onChange={(e) => { setExamType(e.target.value as ExamType); setSubjectFilter(''); setChapterFilter(''); setTopicFilter(''); setSubTopic(''); }} className={`${sselect} w-full`}>
                  {EXAM_TYPES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </div>
              <TaxonomySelect label="Subject" value={subjectFilter} onChange={(v) => { setSubjectFilter(v); setChapterFilter(''); setTopicFilter(''); setSubTopic(''); }}
                options={availableSubjects.map((s) => ({ id: s, label: s }))} placeholder="Select subject" />
              {availableChapters.length > 0 && (
                <TaxonomySelect label="Chapter" value={chapterFilter} onChange={(v) => { setChapterFilter(v); setTopicFilter(''); setSubTopic(''); }}
                  options={availableChapters.map((ch) => ({ id: ch.id, label: ch.label }))} placeholder="Select chapter" />
              )}
              {availableTopics.length > 0 && (
                <TaxonomySelect label="Topic" value={topicFilter} onChange={(v) => { setTopicFilter(v); setSubTopic(''); }}
                  options={availableTopics.map((t) => ({ id: t.id, label: t.label }))} placeholder="Select topic" />
              )}
              {(() => {
                const topic = availableTopics.find((t) => t.id === topicFilter);
                return topic?.children?.length ? (
                  <TaxonomySelect label="Sub-Topic" value={subTopic} onChange={setSubTopic}
                    options={topic.children.map((st) => ({ id: st.id, label: st.label }))} placeholder="Select sub-topic" />
                ) : null;
              })()}
            </div>

            {/* Question Properties */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Question Properties</h4>
              <div>
                <label className={sl}>Question Type</label>
                <div className="grid grid-cols-4 gap-1">
                  {QUESTION_TYPES.map((qt) => (
                    <button key={qt.id} type="button" onClick={() => updateCurrentField('question_type', qt.id)}
                      className={`rounded-md border px-1 py-1.5 text-center text-[9px] font-bold transition ${(currentDraft?.question_type || 'single_choice') === qt.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                      {qt.shortLabel}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={sl}>Difficulty</label>
                <div className="flex gap-1">
                  {DIFFICULTY_LEVELS.map((d) => (
                    <button key={d.id} type="button" onClick={() => updateCurrentField('difficulty_level', d.id)}
                      className={`flex-1 rounded-md border px-1.5 py-1.5 text-[10px] font-bold transition ${(currentDraft?.difficulty_level || 'medium') === d.id ? `border-${d.color}-400 bg-${d.color}-50 text-${d.color}-700` : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={sl}>Marks</label>
                  <input type="number" min="0" step="0.25" value={currentDraft?.marks || '1'} onChange={(e) => updateCurrentField('marks', e.target.value)} className={sf} />
                </div>
                <div>
                  <label className={sl}>Negative</label>
                  <input type="number" min="0" step="0.25" value={currentDraft?.negative_marks || '0'} onChange={(e) => updateCurrentField('negative_marks', e.target.value)} className={sf} />
                </div>
                <div>
                  <label className={sl}>Time (s)</label>
                  <input type="number" min="10" value={estimatedTime} onChange={(e) => setEstimatedTime(e.target.value)} className={sf} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={sl}>Display Order</label>
                  <input type="number" min="1" value={currentDraft?.display_order || '1'} onChange={(e) => updateCurrentField('display_order', e.target.value)} className={sf} />
                </div>
                <div>
                  <label className={sl}>Language</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${sselect} w-full`}>
                    {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Source */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Source & Identity</h4>
              <div>
                <label className={sl}>Question Source</label>
                <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setSourceName(QUESTION_SOURCES.find((s) => s.id === e.target.value)?.label || ''); }} className={`${sselect} w-full`}>
                  <option value="">Select source</option>
                  {QUESTION_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={sl}>Source Name</label>
                  <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} className={sf} placeholder="e.g. HC Verma Ch.5" />
                </div>
                <div>
                  <label className={sl}>Question Code</label>
                  <input value={questionCode || currentDraft?.question_code || ''} onChange={(e) => { setQuestionCode(e.target.value); updateCurrentField('question_code', e.target.value); }} className={sf} placeholder="PHY-001" />
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <h4 className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <Tag className="h-3 w-3" /> Tags
              </h4>
              <div className="flex flex-wrap gap-1">
                {QUESTION_TAGS.map((t) => (
                  <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
                    className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${selectedTags.includes(t.id) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                    {t.icon && <span className="text-[8px]">{t.icon}</span>}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status & Visibility */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Status & Visibility</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={sl}>Status</label>
                  <select value={questionStatus} onChange={(e) => setQuestionStatus(e.target.value)} className={`${sselect} w-full`}>
                    {['draft', 'review', 'approved', 'published', 'archived', 'rejected'].map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={sl}>Visibility</label>
                  <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={`${sselect} w-full`}>
                    {['private', 'school', 'public'].map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Image Upload */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Question Image</h4>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[11px] font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50">
                <ImageIcon className="h-4 w-4" /> {currentDraft?.question_image_url ? 'Change image' : 'Upload image'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleQuestionImageUpload(currentIndex, f); }} />
              </label>
              {currentDraft?.question_image_url && (
                <div className="relative">
                  <img src={currentDraft.question_image_url} alt="" className="max-h-28 w-full rounded-lg border border-slate-200 object-contain" />
                  <button type="button" onClick={() => updateCurrentField('question_image_url', '')} className="absolute right-1 top-1 rounded bg-white/80 p-0.5 text-rose-500 hover:bg-white"><Trash2 className="h-3 w-3" /></button>
                </div>
              )}
              {uploadingAssetKey === `q-img-${currentIndex}` && <p className="text-[10px] text-slate-400">Uploading... {assetUploadProgress[`q-img-${currentIndex}`] || 0}%</p>}
            </div>
          </div>

          {/* Question Nav Footer */}
          <div className="sticky bottom-0 border-t border-slate-100 bg-white px-4 py-2">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setCurrentIndex((p) => Math.max(0, p - 1))} disabled={currentIndex === 0}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <span className="text-[10px] font-bold text-slate-400">{currentIndex + 1} / {questionDrafts.length}</span>
              <button type="button" onClick={() => setCurrentIndex((p) => Math.min(questionDrafts.length - 1, p + 1))} disabled={currentIndex >= questionDrafts.length - 1}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </aside>

        {/* ──────── CENTER PANEL: Question Editor ──────── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          <div className="mx-auto w-full max-w-4xl space-y-4">
            {/* Question Type Strip */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Q{currentIndex + 1}</span>
              <div className="h-4 w-px bg-slate-200" />
              <span className="text-[10px] font-bold text-blue-700">{QUESTION_TYPES.find((t) => t.id === (currentDraft?.question_type || 'single_choice'))?.label}</span>
              <div className="h-4 w-px bg-slate-200" />
              <span className="text-[10px] font-bold text-slate-500">{currentDraft?.difficulty_level} · {currentDraft?.marks} marks</span>
              {subjectFilter && <><div className="h-4 w-px bg-slate-200" /><span className="text-[10px] text-slate-500">{subjectFilter}</span></>}
              {chapterFilter && <span className="text-[10px] text-slate-400">› {availableChapters.find((ch) => ch.id === chapterFilter)?.label}</span>}
              {topicFilter && <span className="text-[10px] text-slate-400">› {availableTopics.find((t) => t.id === topicFilter)?.label}</span>}
            </div>

            {/* Prompt Editor */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <h3 className="text-[12px] font-bold text-slate-900">Question Prompt</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">{(currentDraft?.prompt_text || '').length} chars</span>
                  <button type="button" onClick={() => setShowFormulaPanel(!showFormulaPanel)} className={`rounded p-1 text-[10px] font-bold ${showFormulaPanel ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-100'}`}>
                    <Wand2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {showFormulaPanel && (
                <div className="border-b border-slate-100 p-3">
                  <FormulaPanel onInsert={insertFormula} onClose={() => setShowFormulaPanel(false)} />
                </div>
              )}
              <div className="p-1">
                <textarea
                  value={currentDraft?.prompt_text || ''}
                  onChange={(e) => updateCurrentField('prompt_text', e.target.value)}
                  className="w-full resize-none rounded-lg border-0 bg-[#fafbfc] p-4 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:bg-white min-h-[180px]"
                  placeholder="Type your question here..."
                />
              </div>
              {currentDraft?.question_image_url && (
                <div className="border-t border-slate-100 px-4 py-2">
                  <img src={currentDraft.question_image_url} alt="" className="max-h-40 rounded-lg border border-slate-200 object-contain" />
                </div>
              )}
            </section>

            {/* Options (for choice types) */}
            {hasChoiceType && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[12px] font-bold text-slate-900">Answer Options</h3>
                  <span className="text-[10px] text-slate-400">Mark correct with green circle</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(currentDraft?.option_lines.split('\n').filter(Boolean).length > 0
                    ? currentDraft.option_lines.split('\n').filter(Boolean)
                    : ['', '', '', '']
                  ).map((line, optIdx) => {
                    const text = line.split('|')[0]?.trim() || '';
                    const imageUrl = line.split('|')[1]?.trim() || '';
                    const isCorrect = (currentDraft?.answer_lines || '').toLowerCase().includes(text.toLowerCase()) && text.length > 0;
                    return (
                      <div key={optIdx} className={`relative rounded-xl border p-3 transition ${isCorrect ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}`}>
                        <div className="mb-2 flex items-center gap-2">
                          <button type="button" onClick={() => {
                            const lines = (currentDraft?.option_lines || '').split('\n').filter(Boolean);
                            const optText = lines[optIdx]?.split('|')[0]?.trim() || '';
                            updateCurrentField('answer_lines', optText);
                          }}
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition ${isCorrect ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-slate-500 hover:border-emerald-400'}`}>
                            {isCorrect ? '✓' : String.fromCharCode(65 + optIdx)}
                          </button>
                          <input value={text} onChange={(e) => {
                            const lines = (currentDraft?.option_lines || '').split('\n');
                            while (lines.length <= optIdx) lines.push('');
                            const img = lines[optIdx]?.split('|')[1]?.trim() || '';
                            lines[optIdx] = img ? `${e.target.value} | ${img}` : e.target.value;
                            updateCurrentField('option_lines', lines.join('\n'));
                          }} className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" placeholder={`Option ${String.fromCharCode(65 + optIdx)}`} />
                          {imageUrl && <button type="button" onClick={() => {
                            const lines = (currentDraft?.option_lines || '').split('\n');
                            while (lines.length <= optIdx) lines.push('');
                            lines[optIdx] = lines[optIdx]?.split('|')[0]?.trim() || '';
                            updateCurrentField('option_lines', lines.join('\n'));
                          }} className="text-[9px] text-rose-400 hover:text-rose-600">✕</button>}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex-1 cursor-pointer text-[10px] font-medium text-slate-400 hover:text-blue-600">
                            + Image
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleOptionImageUpload(currentIndex, optIdx, f); }} />
                          </label>
                          {uploadingAssetKey === `opt-img-${currentIndex}-${optIdx}` && <span className="text-[9px] text-slate-400">Uploading...</span>}
                        </div>
                        {imageUrl && <img src={imageUrl} alt="" className="mt-2 max-h-14 rounded border border-slate-200 object-contain" />}
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => {
                  const lines = (currentDraft?.option_lines || '').split('\n').filter(Boolean);
                  lines.push('');
                  updateCurrentField('option_lines', lines.join('\n'));
                }} className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                  <Plus className="h-3 w-3" /> Add option
                </button>
              </section>
            )}

            {/* Answer */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-[12px] font-bold text-slate-900">Correct Answer</h3>
              <textarea value={currentDraft?.answer_lines || ''} onChange={(e) => updateCurrentField('answer_lines', e.target.value)} rows={2}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-100"
                placeholder={hasChoiceType ? 'Enter correct option text or id' : 'Enter answer'} />
            </section>

            {/* Explanation */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-[12px] font-bold text-slate-900">Explanation</h3>
              <textarea value={currentDraft?.explanation || ''} onChange={(e) => updateCurrentField('explanation', e.target.value)} rows={3}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-100"
                placeholder="Detailed explanation shown during review..." />
            </section>

            {/* Danger Zone */}
            <div className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/50 p-3 pb-4">
              <button type="button" onClick={duplicateCurrent} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
                <Copy className="h-3 w-3" /> Duplicate
              </button>
              <button type="button" onClick={() => { if (questionDrafts.length > 1) removeQuestion(currentIndex); }} disabled={questionDrafts.length <= 1}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-30">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          </div>
        </main>

        {/* ──────── RIGHT PANEL ──────── */}
        <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
          {rightView === 'preview' ? (
            <div className="p-4">
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Live Preview</h3>
              {/* Device Frame */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-red-400" />
                    <div className="h-2 w-2 rounded-full bg-amber-400" />
                    <div className="h-2 w-2 rounded-full bg-green-400" />
                  </div>
                  <span className="flex-1 text-center text-[9px] font-bold text-slate-500">Student View</span>
                  <div className="flex gap-1">
                    {['📱', '💻', '🖥️'].map((d, i) => <button key={i} className="text-[10px] opacity-60 hover:opacity-100">{d}</button>)}
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">Q{currentIndex + 1}</span>
                    <span className="text-[9px] font-bold text-slate-500 uppercase">{currentDraft?.question_type?.replace('_', ' ')}</span>
                    <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">{currentDraft?.marks} marks</span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-slate-800">
                    {currentDraft?.prompt_text || <span className="italic text-slate-400">Start typing to preview...</span>}
                  </p>
                  {currentDraft?.question_image_url && (
                    <img src={currentDraft.question_image_url} alt="" className="max-h-32 rounded-lg border border-slate-200 object-contain" />
                  )}
                  {hasChoiceType && currentDraft?.option_lines && (
                    <div className="space-y-1.5">
                      {currentDraft.option_lines.split('\n').filter(Boolean).map((line, i) => {
                        const text = line.split('|')[0]?.trim() || '';
                        const isCorrect = (currentDraft.answer_lines || '').toLowerCase().includes(text.toLowerCase()) && text.length > 0;
                        return (
                          <div key={i} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${isCorrect ? 'border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${isCorrect ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}">
                              {isCorrect ? '✓' : String.fromCharCode(65 + i)}
                            </span>
                            {text}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {currentDraft?.explanation && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[10px] text-amber-800">
                      <span className="font-bold">Explanation: </span>{currentDraft.explanation}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-center">
                  <p className="text-[14px] font-bold text-slate-900">{questionCount}</p>
                  <p className="text-[9px] text-slate-500">Questions</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-center">
                  <p className="text-[14px] font-bold text-slate-900">{totalMarks}</p>
                  <p className="text-[9px] text-slate-500">Total Marks</p>
                </div>
              </div>
            </div>
          ) : (
            /* Tools View */
            <div className="p-4 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tools</h3>
              {[
                { key: 'ai' as const, label: 'AI Generator', icon: Bot, color: 'violet' },
                { key: 'ocr' as const, label: 'OCR Scanner', icon: ImageIcon, color: 'emerald' },
                { key: 'pdf' as const, label: 'PDF Import', icon: FileUp, color: 'rose' },
                { key: 'formula' as const, label: 'Formula Builder', icon: Wand2, color: 'amber' },
                { key: 'history' as const, label: 'Version History', icon: History, color: 'blue' },
              ].map((tool) => (
                <button key={tool.key} type="button" onClick={() => setActiveTool(activeTool === tool.key ? null : tool.key)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${activeTool === tool.key ? `border-${tool.color}-300 bg-${tool.color}-50` : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}>
                  <tool.icon className={`h-4 w-4 text-${tool.color}-500`} />
                  <span className="text-[11px] font-semibold text-slate-700">{tool.label}</span>
                  <ChevronRight className={`ml-auto h-3 w-3 text-slate-400 transition ${activeTool === tool.key ? 'rotate-90' : ''}`} />
                </button>
              ))}

              {/* Active tool panel */}
              {activeTool === 'ai' && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                  <AIGenerator currentExam={examType} currentSubject={subjectFilter} currentChapter={chapterFilter} currentTopic={topicFilter} onGenerated={handleAIGenerated} />
                </div>
              )}
              {activeTool === 'ocr' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <OCRPanel onImported={handleOCRImport} onClose={() => setActiveTool(null)} />
                </div>
              )}
              {activeTool === 'pdf' && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
                  <PDFImportPanel onImported={handlePDFImport} onClose={() => setActiveTool(null)} />
                </div>
              )}
              {activeTool === 'formula' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <FormulaPanel onInsert={insertFormula} onClose={() => setActiveTool(null)} />
                </div>
              )}
              {activeTool === 'history' && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                  <h4 className="mb-2 text-[11px] font-bold text-blue-900">Version History</h4>
                  <VersionHistory versions={versions} onRestore={(vid) => { void vid; setBanner({ type: 'info', message: 'Version restore requested.' }); }} />
                </div>
              )}

              {/* Recent Images placeholder */}
              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Recent Images</h4>
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[18px] text-slate-300">
                      {i < 3 ? ['📐', '⚗️', '📊'][i] : ''}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ════════════ BOTTOM ACTION BAR ════════════ */}
      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-5 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(testId ? `/online-tests/edit/${testId}` : '/question-bank')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => void saveQuestions()} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save Draft'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={addQuestion}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" /> Add Question
          </button>
          <button type="button" onClick={() => void handleSaveAndNext()} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a8a] px-4 py-2 text-[11px] font-semibold text-white hover:bg-[#1b3277] disabled:opacity-50">
            Save & Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => void handlePublish()} disabled={publishing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <CheckCircle2 className="h-3.5 w-3.5" /> {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </footer>
    </div>
  );
}
