-- Bounded database-only load/count verification against synthetic rows.
-- Does not call any external ERP/store and rolls back every fixture.
BEGIN;
DO $$
DECLARE
  owner_id text:='reliability-load-'||gen_random_uuid()::text;
  workspaces uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  connections uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  receipt uuid; job uuid; token uuid; i int; slot int; total int;
BEGIN
  INSERT INTO public.users(id,email,name) VALUES(owner_id,owner_id||'@example.invalid','Synthetic database load');
  FOR i IN 1..3 LOOP
    INSERT INTO public.workspaces(id,user_id,name) VALUES(workspaces[i],owner_id,'Synthetic tenant '||i);
    INSERT INTO public.erp_connections(id,workspace_id,erp_type,connection_name,url,db_name,username,password,status)
    VALUES(connections[i],workspaces[i],'odoo','Synthetic','https://fixture.invalid','fixture','fixture','fake-key','connected');
  END LOOP;
  FOR i IN 1..1000 LOOP
    slot:=1+(i%3);
    INSERT INTO public.webhook_inbox(workspace_id,platform,store_id,event,payload,dedup_key,erp_connection_id,connection_generation)
    VALUES(workspaces[slot],'zid','synthetic-store','order.create',jsonb_build_object('id',i),
      'load-'||i,connections[slot],'synthetic-generation') RETURNING id INTO receipt;
    job:=public.dispatch_webhook_receipt(receipt,'{}');
    IF NOT EXISTS(SELECT 1 FROM public.sync_queue WHERE id=job AND workspace_id=workspaces[slot] AND erp_connection_id=connections[slot]) THEN
      RAISE EXCEPTION 'FAIL: cross-tenant dispatch %',i;
    END IF;
    SELECT lease_token INTO token FROM public.claim_sync_job(job,false,900);
    IF token IS NULL THEN RAISE EXCEPTION 'FAIL: unclaimable event %',i; END IF;
    DELETE FROM public.sync_queue WHERE id=job AND lease_token=token;
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: fenced completion %',i; END IF;
    IF public.dispatch_webhook_receipt(receipt,'{}')<>job THEN RAISE EXCEPTION 'FAIL: replay %',i; END IF;
  END LOOP;
  SELECT count(*) INTO total FROM public.webhook_inbox WHERE workspace_id=ANY(workspaces) AND queue_id IS NOT NULL;
  IF total<>1000 THEN RAISE EXCEPTION 'FAIL: lost receipts %',total; END IF;
  SELECT count(*) INTO total FROM public.sync_queue WHERE workspace_id=ANY(workspaces);
  IF total<>0 THEN RAISE EXCEPTION 'FAIL: replayed completed jobs %',total; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: 1000 receipt/dispatch/claim/settle/replay cycles across 3 synthetic tenants; all fixtures rolled back' AS result;
