-- Add a B-tree index for each public foreign key that lacks a valid, non-partial
-- covering index. Evaluate the live catalog at migration time instead of hard-coding column
-- names, because older reconstructed schema files can differ from the current live schema.
-- On the live project reviewed on 2026-10-21 this was expected to cover 115 foreign keys.

DO $migration$
DECLARE
  fk record;
  index_name text;
  column_list text;
BEGIN
  FOR fk IN
    SELECT
      c.conrelid AS table_oid,
      ns.nspname AS schema_name,
      tbl.relname AS table_name,
      c.conname AS constraint_name,
      c.conkey AS key_columns,
      ARRAY(
        SELECT a.attname::text
        FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = key.attnum
        ORDER BY key.ord
      ) AS column_names
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE c.contype = 'f'
      AND ns.nspname = 'public'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = ix.relam
      WHERE i.indrelid = fk.table_oid
        AND i.indisvalid
        AND i.indisready
        AND i.indpred IS NULL
        AND am.amname = 'btree'
        AND (
          SELECT pg_catalog.array_agg(key.attnum::smallint ORDER BY key.ord)
          FROM pg_catalog.unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
          WHERE key.ord <= pg_catalog.cardinality(fk.key_columns)
            AND key.ord <= i.indnkeyatts
        ) = fk.key_columns
    ) THEN
      SELECT pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY key.ord)
      INTO column_list
      FROM pg_catalog.unnest(fk.key_columns) WITH ORDINALITY AS key(attnum, ord)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = fk.constraint_oid::regclass::oid
       AND a.attnum = key.attnum;

      index_name :=
        'idx_fk_' ||
        pg_catalog.left(fk.table_name, 22) || '_' ||
        pg_catalog.left(pg_catalog.array_to_string(fk.column_names, '_'), 16) || '_' ||
        pg_catalog.substr(
          pg_catalog.md5(fk.table_name || '|' || pg_catalog.array_to_string(fk.column_names, '|')),
          1, 8
        );

      EXECUTE pg_catalog.format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
        index_name, fk.schema_name, fk.table_name, column_list
      );
    END IF;
  END LOOP;
END $migration$;
