-- Synthetic database-only smoke/fault test. Every fixture is rolled back.
-- No merchant/Odoo API calls, credentials or existing payloads are used.
BEGIN;
DO $$
DECLARE
  owner_id text := 'reliability-test-'||gen_random_uuid()::text;
  ws_a uuid := gen_random_uuid(); ws_b uuid := gen_random_uuid();
  conn_a uuid := gen_random_uuid(); conn_b uuid := gen_random_uuid();
  receipt_a uuid; receipt_b uuid; job_a uuid; job_b uuid; lease uuid;
  total int; i int;
BEGIN
  INSERT INTO public.users(id,email,name) VALUES(owner_id,owner_id||'@example.invalid','Synthetic reliability test');
  INSERT INTO public.workspaces(id,user_id,name) VALUES(ws_a,owner_id,'Reliability A'),(ws_b,owner_id,'Reliability B');
  INSERT INTO public.erp_connections(id,workspace_id,erp_type,connection_name,url,db_name,username,password,status)
  VALUES(conn_a,ws_a,'odoo','Fixture A','https://a.invalid','fixture','fixture','not-a-real-key','connected'),
        (conn_b,ws_b,'odoo','Fixture B','https://b.invalid','fixture','fixture','not-a-real-key','connected');

  INSERT INTO public.webhook_inbox(workspace_id,platform,store_id,event,payload,dedup_key,erp_connection_id,connection_generation)
  VALUES(ws_a,'zid','fixture-store','order.create','{"id":1}','same-delivery',conn_a,'fixture-generation') RETURNING id INTO receipt_a;
  INSERT INTO public.webhook_inbox(workspace_id,platform,store_id,event,payload,dedup_key,erp_connection_id,connection_generation)
  VALUES(ws_b,'zid','fixture-store','order.create','{"id":1}','same-delivery',conn_b,'fixture-generation') RETURNING id INTO receipt_b;
  job_a := public.dispatch_webhook_receipt(receipt_a,'{"workspace_id":"00000000-0000-0000-0000-000000000000","max_retries":5}');
  job_b := public.dispatch_webhook_receipt(receipt_b,'{}');
  IF NOT EXISTS(SELECT 1 FROM public.sync_queue WHERE id=job_a AND workspace_id=ws_a AND erp_connection_id=conn_a) THEN
    RAISE EXCEPTION 'FAIL: dispatch trusted JSON ownership';
  END IF;
  FOR i IN 1..1000 LOOP
    IF public.dispatch_webhook_receipt(receipt_a,'{}')<>job_a THEN RAISE EXCEPTION 'FAIL: repeated receipt created a new job'; END IF;
  END LOOP;
  SELECT count(*) INTO total FROM public.sync_queue WHERE workspace_id IN(ws_a,ws_b);
  IF total<>2 THEN RAISE EXCEPTION 'FAIL: duplicate dispatch count %',total; END IF;
  SELECT lease_token INTO lease FROM public.claim_sync_job(job_a,false,900);
  IF lease IS NULL THEN RAISE EXCEPTION 'FAIL: first claim'; END IF;
  SELECT count(*) INTO total FROM public.claim_sync_job(job_a,true,900);
  IF total<>0 THEN RAISE EXCEPTION 'FAIL: Send Now stole an active lease'; END IF;
  SELECT count(*) INTO total FROM public.claim_sync_job(job_b,false,900);
  IF total<>1 THEN RAISE EXCEPTION 'FAIL: another tenant blocked'; END IF;
  DELETE FROM public.sync_queue WHERE id=job_a AND lease_token=gen_random_uuid();
  IF NOT EXISTS(SELECT 1 FROM public.sync_queue WHERE id=job_a) THEN RAISE EXCEPTION 'FAIL: stale worker settled another lease'; END IF;
  UPDATE public.sync_queue SET lease_expires_at=now()-interval '1 second' WHERE id=job_a;
  PERFORM public.expire_sync_job_leases();
  IF NOT EXISTS(SELECT 1 FROM public.sync_queue WHERE id=job_a AND outcome_unknown AND next_retry_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: expired lease not retained as unknown';
  END IF;
  SELECT count(*) INTO total FROM public.claim_sync_job(job_a,true,900);
  IF total<>0 THEN RAISE EXCEPTION 'FAIL: unknown outcome replayed'; END IF;
  DELETE FROM public.sync_queue WHERE id=job_b;
  IF public.dispatch_webhook_receipt(receipt_b,'{}')<>job_b OR EXISTS(SELECT 1 FROM public.sync_queue WHERE receipt_id=receipt_b) THEN
    RAISE EXCEPTION 'FAIL: completed job resurrected after queue deletion';
  END IF;

  -- Same external entity, different deliveries: only one may execute at once.
  FOR i IN 1..2 LOOP
    INSERT INTO public.webhook_inbox(workspace_id,platform,store_id,event,payload,dedup_key,erp_connection_id,connection_generation)
    VALUES(ws_a,'zid','fixture-store','order.updated','{"id":2}','entity-2-'||i,conn_a,'fixture-generation') RETURNING id INTO receipt_a;
    IF i=1 THEN job_a:=public.dispatch_webhook_receipt(receipt_a,'{}');
    ELSE job_b:=public.dispatch_webhook_receipt(receipt_a,'{}'); END IF;
  END LOOP;
  PERFORM public.claim_sync_job(job_a,false,900);
  SELECT count(*) INTO total FROM public.claim_sync_job(job_b,true,900);
  IF total<>0 THEN RAISE EXCEPTION 'FAIL: same entity executed concurrently'; END IF;

  -- Foreign connection fails in the database, independently of app predicates.
  INSERT INTO public.webhook_inbox(workspace_id,platform,store_id,event,payload,dedup_key,erp_connection_id,connection_generation)
  VALUES(ws_a,'zid','fixture-store','order.create','{"id":3}','forged',conn_b,'fixture-generation') RETURNING id INTO receipt_a;
  BEGIN
    PERFORM public.dispatch_webhook_receipt(receipt_a,'{}');
    RAISE EXCEPTION 'FAIL: foreign connection dispatched';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Receipt connection is outside workspace%' THEN RAISE; END IF;
  END;
  IF has_function_privilege('anon','public.claim_sync_job(uuid,boolean,integer)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: public claim access'; END IF;
  IF has_table_privilege('authenticated','public.erp_effects','SELECT') THEN RAISE EXCEPTION 'FAIL: public effect ledger access'; END IF;
  RAISE NOTICE 'PASS: durable dispatch, 1000 replays, tenant isolation, active lease, fencing, crash quarantine and no resurrection';
END $$;
ROLLBACK;
SELECT 'PASS: dispatch, replay, isolation, leases, unknown quarantine and recovery linkage' AS result;
