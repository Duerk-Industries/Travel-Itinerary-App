CREATE TABLE IF NOT EXISTS ai_daily_metrics (
  period_start DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'day',
  feature_key TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_start, period_type, feature_key, metric_key)
);

CREATE TABLE IF NOT EXISTS ai_provider_metrics (
  period_start DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'day',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_start, period_type, provider, model, metric_key)
);

CREATE TABLE IF NOT EXISTS ai_prompt_metrics (
  period_start DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'day',
  feature_key TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_start, period_type, feature_key, caller_id, metric_key)
);

CREATE TABLE IF NOT EXISTS ai_parser_metrics (
  period_start DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'day',
  parser_name TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_start, period_type, parser_name, metric_key)
);

CREATE TABLE IF NOT EXISTS ai_field_metrics (
  period_start DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'day',
  item_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_start, period_type, item_type, field_name, metric_key)
);

CREATE TABLE IF NOT EXISTS ai_cost_metrics (
  period_start DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'day',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_start, period_type, provider, model, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_daily_metrics_period ON ai_daily_metrics(period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ai_provider_metrics_period ON ai_provider_metrics(period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_metrics_period ON ai_prompt_metrics(period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ai_parser_metrics_period ON ai_parser_metrics(period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ai_field_metrics_period ON ai_field_metrics(period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cost_metrics_period ON ai_cost_metrics(period_type, period_start DESC);
