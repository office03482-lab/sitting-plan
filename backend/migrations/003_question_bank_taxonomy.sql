-- ============================================================
-- QUESTION BANK SYSTEM - Hierarchical Taxonomy Tables
-- Deploy this via Supabase SQL Editor
-- ============================================================

-- 1. Exam Types
CREATE TABLE IF NOT EXISTS qb_exam_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, slug)
);

-- 2. Taxonomy Tree (subjects, chapters, topics, sub_topics)
CREATE TABLE IF NOT EXISTS qb_taxonomy_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  parent_id UUID REFERENCES qb_taxonomy_nodes(id) ON DELETE CASCADE,
  exam_type_slug TEXT NOT NULL DEFAULT 'custom',
  node_type TEXT NOT NULL CHECK (node_type IN ('subject', 'chapter', 'topic', 'sub_topic')),
  name TEXT NOT NULL,
  display_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_taxonomy_parent ON qb_taxonomy_nodes(school_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_qb_taxonomy_exam ON qb_taxonomy_nodes(school_id, exam_type_slug, node_type);

-- 3. Question Tags
CREATE TABLE IF NOT EXISTS qb_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  icon TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, slug)
);

-- 4. Question Sources
CREATE TABLE IF NOT EXISTS qb_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT DEFAULT 'self',
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, name)
);

-- 5. Enhanced Question Bank
CREATE TABLE IF NOT EXISTS qb_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  created_by UUID,
  updated_by UUID,
  question_code TEXT,

  -- Taxonomy
  exam_type_slug TEXT DEFAULT 'custom',
  subject_id UUID REFERENCES qb_taxonomy_nodes(id),
  chapter_id UUID REFERENCES qb_taxonomy_nodes(id),
  topic_id UUID REFERENCES qb_taxonomy_nodes(id),
  sub_topic_id UUID REFERENCES qb_taxonomy_nodes(id),

  -- Fallback text fields (for free-text taxonomy or backward compat)
  subject TEXT,
  chapter TEXT,
  topic TEXT,
  sub_topic TEXT,

  -- Question content
  question_type TEXT NOT NULL DEFAULT 'single_choice',
  difficulty_level TEXT DEFAULT 'medium',
  prompt_text TEXT NOT NULL,
  prompt_html TEXT,
  option_items JSONB DEFAULT '[]',
  answer_key JSONB DEFAULT '{}',
  explanation TEXT,
  explanation_html TEXT,
  teacher_notes TEXT,
  student_notes TEXT,
  hints TEXT,
  solution TEXT,
  solution_html TEXT,

  -- Scoring
  marks NUMERIC DEFAULT 1,
  negative_marks NUMERIC DEFAULT 0,
  estimated_time_seconds INT DEFAULT 120,

  -- Source
  source_id UUID REFERENCES qb_sources(id),
  source_name TEXT,

  -- Language & visibility
  language TEXT DEFAULT 'en',
  visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'school', 'public')),
  question_owner TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  question_image_url TEXT,
  tags JSONB DEFAULT '[]',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'published', 'archived', 'rejected')),
  display_order INT DEFAULT 0,

  -- Versioning
  version INT DEFAULT 1,

  -- Soft delete
  is_active BOOLEAN DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_questions_school ON qb_questions(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_qb_questions_exam ON qb_questions(school_id, exam_type_slug);
CREATE INDEX IF NOT EXISTS idx_qb_questions_subject ON qb_questions(school_id, subject);
CREATE INDEX IF NOT EXISTS idx_qb_questions_status ON qb_questions(school_id, status);
CREATE INDEX IF NOT EXISTS idx_qb_questions_difficulty ON qb_questions(school_id, difficulty_level);

-- 6. Question Version History
CREATE TABLE IF NOT EXISTS qb_question_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  school_id UUID NOT NULL,
  version INT NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by UUID,
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_versions_question ON qb_question_versions(question_id, version DESC);

-- 7. Question Edit History (audit log)
CREATE TABLE IF NOT EXISTS qb_question_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  school_id UUID NOT NULL,
  action TEXT NOT NULL,
  field_changed TEXT,
  old_value JSONB,
  new_value JSONB,
  performed_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_history_question ON qb_question_history(question_id, created_at DESC);

-- 8. Question Bank ↔ Test linking (many-to-many)
CREATE TABLE IF NOT EXISTS qb_bank_test_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_question_id UUID NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  test_id UUID NOT NULL,
  school_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_question_id, test_id)
);

-- ============================================================
-- RLS Policies (Row Level Security)
-- ============================================================
ALTER TABLE qb_exam_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_taxonomy_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_question_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_bank_test_links ENABLE ROW LEVEL SECURITY;

-- Service-role bypass policies
CREATE POLICY "service_role_all_exam_types" ON qb_exam_types FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_taxonomy" ON qb_taxonomy_nodes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_tags" ON qb_tags FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_sources" ON qb_sources FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_questions" ON qb_questions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_versions" ON qb_question_versions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_history" ON qb_question_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_links" ON qb_bank_test_links FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- Seed Default Data (run once per school)
-- ============================================================
-- The frontend handles taxonomy via hardcoded data.
-- Backend creates taxonomy nodes on-demand via "Create New" buttons.
