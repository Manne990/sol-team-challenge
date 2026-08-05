ALTER TABLE pipeline_stages ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
CREATE INDEX pipeline_stage_order_idx ON pipeline_stages(organization_id,active,position,id);
