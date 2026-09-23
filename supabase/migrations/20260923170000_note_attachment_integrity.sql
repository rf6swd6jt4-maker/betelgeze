-- Separate table-specific statements before resolving NEW fields. No record rewrite.
begin;
CREATE OR REPLACE FUNCTION public.enforce_note_link_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.notes note
        WHERE note.id = NEW.note_id AND note.workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'Note does not belong to the link workspace';
    END IF;
    IF TG_TABLE_NAME = 'note_relationships' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.relationships relationship
            WHERE relationship.id = NEW.relationship_id AND relationship.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'Relationship does not belong to the link workspace';
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'note_assets' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.assets asset
            WHERE asset.id = NEW.asset_id AND asset.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'Asset does not belong to the link workspace';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
notify pgrst, 'reload schema';
commit;
