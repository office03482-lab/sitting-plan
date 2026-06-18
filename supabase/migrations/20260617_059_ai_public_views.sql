begin;

-- AI public views
-- PostgREST-safe aliases for ai schema tables.

create or replace view public.ai_ai_learning_context
  with (security_invoker = true)
  as select * from ai.ai_learning_context;

create or replace view public.ai_ai_recommendations
  with (security_invoker = true)
  as select * from ai.ai_recommendations;

create or replace view public.ai_ai_conversations
  with (security_invoker = true)
  as select * from ai.ai_conversations;

create or replace view public.ai_teacher_assistant_jobs
  with (security_invoker = true)
  as select * from ai.teacher_assistant_jobs;

create or replace view public.ai_generated_papers
  with (security_invoker = true)
  as select * from ai.generated_papers;

create or replace view public.ai_generated_assignments
  with (security_invoker = true)
  as select * from ai.generated_assignments;

create or replace view public.ai_generated_reports
  with (security_invoker = true)
  as select * from ai.generated_reports;

create or replace view public.ai_doubt_sessions
  with (security_invoker = true)
  as select * from ai.doubt_sessions;

create or replace view public.ai_doubt_questions
  with (security_invoker = true)
  as select * from ai.doubt_questions;

create or replace view public.ai_doubt_solutions
  with (security_invoker = true)
  as select * from ai.doubt_solutions;

create or replace view public.ai_doubt_recommendations
  with (security_invoker = true)
  as select * from ai.doubt_recommendations;

create or replace view public.ai_agent_registry
  with (security_invoker = true)
  as select * from ai.agent_registry;

create or replace view public.ai_agent_jobs
  with (security_invoker = true)
  as select * from ai.agent_jobs;

create or replace view public.ai_agent_recommendations
  with (security_invoker = true)
  as select * from ai.agent_recommendations;

create or replace view public.ai_agent_actions
  with (security_invoker = true)
  as select * from ai.agent_actions;

notify pgrst, 'reload schema';

commit;
