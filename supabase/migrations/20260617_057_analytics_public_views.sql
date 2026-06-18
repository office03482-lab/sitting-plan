-- Analytics Public Views
-- Migrates from schema("analytics") to public views for PostgREST compatibility
-- Apply via Supabase Dashboard SQL Editor

-- Topic Performance
CREATE OR REPLACE VIEW public.analytics_topic_performance
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.topic_performance;

-- Student Performance
CREATE OR REPLACE VIEW public.analytics_student_performance
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.student_performance;

-- Test Analytics
CREATE OR REPLACE VIEW public.analytics_test_analytics
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.test_analytics;

-- School Analytics
CREATE OR REPLACE VIEW public.analytics_school_analytics
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.school_analytics;

-- AI Tutor: recommendations
CREATE OR REPLACE VIEW public.analytics_recommendations
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.recommendations;

-- AI Tutor / Study Planner: study_plans
CREATE OR REPLACE VIEW public.analytics_study_plans
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.study_plans;

-- Parent Intelligence: parent_insights
CREATE OR REPLACE VIEW public.analytics_parent_insights
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.parent_insights;

-- Parent Intelligence: student_risk_scores
CREATE OR REPLACE VIEW public.analytics_student_risk_scores
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.student_risk_scores;

-- Parent Intelligence: parent_alerts
CREATE OR REPLACE VIEW public.analytics_parent_alerts
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.parent_alerts;

-- Study Planner: study_tasks
CREATE OR REPLACE VIEW public.analytics_study_tasks
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.study_tasks;

-- Study Planner: learning_goals
CREATE OR REPLACE VIEW public.analytics_learning_goals
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.learning_goals;

-- Predictions: model_registry
CREATE OR REPLACE VIEW public.analytics_model_registry
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.model_registry;

-- Predictions: predictions
CREATE OR REPLACE VIEW public.analytics_predictions
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.predictions;

-- Predictions: risk_scores
CREATE OR REPLACE VIEW public.analytics_risk_scores
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.risk_scores;

-- Predictions: forecasts
CREATE OR REPLACE VIEW public.analytics_forecasts
  WITH (security_invoker = true)
  AS SELECT * FROM analytics.forecasts;
