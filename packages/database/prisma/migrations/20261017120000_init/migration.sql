-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PartnerEntityType" AS ENUM ('COUNTRY', 'TERRITORY', 'AGGREGATE', 'OTHER');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ANNUAL', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PUBLISHED', 'ESTIMATED', 'NOT_PUBLISHED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TradeFlow" AS ENUM ('EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "CompletenessStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'MISSING', 'UNAVAILABLE', 'UNVERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('UN_COMTRADE', 'FIXTURE');

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "m49_code" TEXT NOT NULL,
    "partner_name" TEXT NOT NULL,
    "iso2" TEXT,
    "iso3" TEXT,
    "region" TEXT,
    "entity_type" "PartnerEntityType" NOT NULL,
    "active_status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hs_classifications" (
    "id" TEXT NOT NULL,
    "classification_code" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "effective_period" TEXT NOT NULL,
    "source_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hs_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hs_commodities" (
    "id" TEXT NOT NULL,
    "classification_id" TEXT NOT NULL,
    "hs_code" TEXT NOT NULL,
    "hs_level" INTEGER NOT NULL,
    "parent_code" TEXT,
    "description" TEXT NOT NULL,
    "is_aggregate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hs_commodities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_periods" (
    "id" TEXT NOT NULL,
    "period_code" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_observations" (
    "id" TEXT NOT NULL,
    "identity_key" TEXT NOT NULL,
    "reporter_code" TEXT NOT NULL,
    "partner_code" TEXT NOT NULL,
    "second_partner_code" TEXT NOT NULL DEFAULT '0',
    "period_id" TEXT NOT NULL,
    "flow" "TradeFlow" NOT NULL,
    "commodity_id" TEXT NOT NULL,
    "aggregation_level" INTEGER NOT NULL,
    "customs_code" TEXT NOT NULL DEFAULT 'C00',
    "transport_mode" TEXT NOT NULL DEFAULT '0',
    "trade_value_usd" DECIMAL(24,2) NOT NULL,
    "quantity" DECIMAL(24,6),
    "net_weight" DECIMAL(24,6),
    "source_status" TEXT NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_kind" "DataSourceKind" NOT NULL,
    "is_reported" BOOLEAN NOT NULL DEFAULT true,
    "classification_code" TEXT NOT NULL,
    "cmd_code" TEXT NOT NULL,

    CONSTRAINT "trade_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_period_summaries" (
    "id" TEXT NOT NULL,
    "partner_code" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "export_usd" DECIMAL(24,2),
    "import_usd" DECIMAL(24,2),
    "export_present" BOOLEAN NOT NULL DEFAULT false,
    "import_present" BOOLEAN NOT NULL DEFAULT false,
    "completeness" "CompletenessStatus" NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "source_kind" "DataSourceKind" NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_period_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commodity_period_summaries" (
    "id" TEXT NOT NULL,
    "partner_code" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "commodity_id" TEXT NOT NULL,
    "hs_code" TEXT NOT NULL,
    "hs_level" INTEGER NOT NULL,
    "export_usd" DECIMAL(24,2),
    "import_usd" DECIMAL(24,2),
    "export_present" BOOLEAN NOT NULL DEFAULT false,
    "import_present" BOOLEAN NOT NULL DEFAULT false,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commodity_period_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "partition_key" TEXT NOT NULL,
    "partition_parameters" JSONB NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "next_retry_at" TIMESTAMP(3),
    "records_received" INTEGER NOT NULL DEFAULT 0,
    "records_stored" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoints" (
    "id" TEXT NOT NULL,
    "partition_identifier" TEXT NOT NULL,
    "source_record_count" INTEGER NOT NULL DEFAULT 0,
    "stored_record_count" INTEGER NOT NULL DEFAULT 0,
    "data_coverage" JSONB NOT NULL,
    "completeness_status" "CompletenessStatus" NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "last_verified_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endpoint" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "records_received" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "quota_remaining" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "export_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB NOT NULL,
    "file_location" TEXT,
    "file_name" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_revisions" (
    "id" TEXT NOT NULL,
    "observation_identity" TEXT NOT NULL,
    "observation_id" TEXT,
    "original_value" DECIMAL(24,2) NOT NULL,
    "revised_value" DECIMAL(24,2) NOT NULL,
    "source_update" TEXT,
    "revision_timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_conflicts" (
    "id" TEXT NOT NULL,
    "identity_key" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "observation_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "dataset_meta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "source_kind" "DataSourceKind" NOT NULL,
    "classification_label" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "hs8_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "hs8_note" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_snapshots" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_m49_code_key" ON "partners"("m49_code");

-- CreateIndex
CREATE INDEX "partners_entity_type_active_status_idx" ON "partners"("entity_type", "active_status");

-- CreateIndex
CREATE UNIQUE INDEX "hs_classifications_classification_code_revision_key" ON "hs_classifications"("classification_code", "revision");

-- CreateIndex
CREATE INDEX "hs_commodities_parent_code_idx" ON "hs_commodities"("parent_code");

-- CreateIndex
CREATE INDEX "hs_commodities_hs_level_idx" ON "hs_commodities"("hs_level");

-- CreateIndex
CREATE INDEX "hs_commodities_hs_code_idx" ON "hs_commodities"("hs_code");

-- CreateIndex
CREATE UNIQUE INDEX "hs_commodities_classification_id_hs_code_key" ON "hs_commodities"("classification_id", "hs_code");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_periods_period_code_key" ON "reporting_periods"("period_code");

-- CreateIndex
CREATE INDEX "reporting_periods_frequency_year_month_idx" ON "reporting_periods"("frequency", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "trade_observations_identity_key_key" ON "trade_observations"("identity_key");

-- CreateIndex
CREATE INDEX "trade_observations_partner_code_period_id_flow_idx" ON "trade_observations"("partner_code", "period_id", "flow");

-- CreateIndex
CREATE INDEX "trade_observations_commodity_id_idx" ON "trade_observations"("commodity_id");

-- CreateIndex
CREATE INDEX "trade_observations_aggregation_level_idx" ON "trade_observations"("aggregation_level");

-- CreateIndex
CREATE INDEX "trade_observations_period_id_flow_idx" ON "trade_observations"("period_id", "flow");

-- CreateIndex
CREATE INDEX "trade_observations_source_kind_idx" ON "trade_observations"("source_kind");

-- CreateIndex
CREATE INDEX "partner_period_summaries_period_id_export_usd_idx" ON "partner_period_summaries"("period_id", "export_usd");

-- CreateIndex
CREATE INDEX "partner_period_summaries_period_id_import_usd_idx" ON "partner_period_summaries"("period_id", "import_usd");

-- CreateIndex
CREATE UNIQUE INDEX "partner_period_summaries_partner_code_period_id_key" ON "partner_period_summaries"("partner_code", "period_id");

-- CreateIndex
CREATE INDEX "commodity_period_summaries_period_id_hs_level_export_usd_idx" ON "commodity_period_summaries"("period_id", "hs_level", "export_usd");

-- CreateIndex
CREATE INDEX "commodity_period_summaries_partner_code_period_id_hs_level_idx" ON "commodity_period_summaries"("partner_code", "period_id", "hs_level");

-- CreateIndex
CREATE UNIQUE INDEX "commodity_period_summaries_partner_code_period_id_commodity_key" ON "commodity_period_summaries"("partner_code", "period_id", "commodity_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_job_id_key" ON "sync_jobs"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_partition_key_key" ON "sync_jobs"("partition_key");

-- CreateIndex
CREATE INDEX "sync_jobs_status_priority_created_at_idx" ON "sync_jobs"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "sync_jobs_stage_status_idx" ON "sync_jobs"("stage", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sync_checkpoints_partition_identifier_key" ON "sync_checkpoints"("partition_identifier");

-- CreateIndex
CREATE INDEX "sync_checkpoints_completeness_status_idx" ON "sync_checkpoints"("completeness_status");

-- CreateIndex
CREATE UNIQUE INDEX "api_usage_request_id_key" ON "api_usage"("request_id");

-- CreateIndex
CREATE INDEX "api_usage_timestamp_idx" ON "api_usage"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_export_id_key" ON "export_jobs"("export_id");

-- CreateIndex
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "source_revisions_observation_identity_idx" ON "source_revisions"("observation_identity");

-- CreateIndex
CREATE INDEX "observation_conflicts_identity_key_idx" ON "observation_conflicts"("identity_key");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "availability_snapshots_scope_captured_at_idx" ON "availability_snapshots"("scope", "captured_at");

-- AddForeignKey
ALTER TABLE "hs_commodities" ADD CONSTRAINT "hs_commodities_classification_id_fkey" FOREIGN KEY ("classification_id") REFERENCES "hs_classifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_observations" ADD CONSTRAINT "trade_observations_partner_code_fkey" FOREIGN KEY ("partner_code") REFERENCES "partners"("m49_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_observations" ADD CONSTRAINT "trade_observations_second_partner_code_fkey" FOREIGN KEY ("second_partner_code") REFERENCES "partners"("m49_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_observations" ADD CONSTRAINT "trade_observations_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_observations" ADD CONSTRAINT "trade_observations_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "hs_commodities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_period_summaries" ADD CONSTRAINT "partner_period_summaries_partner_code_fkey" FOREIGN KEY ("partner_code") REFERENCES "partners"("m49_code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_period_summaries" ADD CONSTRAINT "partner_period_summaries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commodity_period_summaries" ADD CONSTRAINT "commodity_period_summaries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commodity_period_summaries" ADD CONSTRAINT "commodity_period_summaries_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "hs_commodities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

