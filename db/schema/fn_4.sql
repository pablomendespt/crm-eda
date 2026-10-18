CREATE OR REPLACE FUNCTION public.vendas_pve_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ BEGIN
 IF NEW.produto='PVE' AND (NEW.forma_pagamento NOT IN ('À vista','Cartão - à vista','Klarna') OR NEW.parcelas<>1) THEN RAISE EXCEPTION 'PVE só permite pagamento à vista ou Klarna, numa parcela'; END IF;
 RETURN NEW;
END $function$
;


