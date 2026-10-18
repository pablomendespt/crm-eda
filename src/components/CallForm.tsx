import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/useAuth';
import { financeRpc } from '@/lib/finance-reporting';
import { friendlyError } from '@/lib/rls-error';
import { createPortal } from 'react-dom';
export function CallForm({onClose,lead}:{onClose:()=>void;lead?:{id:string;nome:string;telefone:string|null;email:string|null;responsavel_member_id?:string|null;sdr_member_id?:string|null}}) {
 const qc=useQueryClient();
 const {data:profile}=useProfile();
 const management=profile?.isGerencia===true;
 const myId=profile?.profile?.member_id;
 const {data:members=[]}=useQuery({queryKey:['members-directory'],queryFn:async()=>{const {data,error}=await supabase.rpc('list_members_directory');if(error)throw error;return data??[];}});
 const [form,setForm]=useState({lead_id:lead?.id||'',nome_lead:lead?.nome||'',tel:lead?.telefone||'',email:lead?.email||'',agendada_para:'',closer_id:lead?.responsavel_member_id||'',sdr_id:management?(lead?.sdr_member_id||''):(myId||''),origem:'EDA',notas:''});
 const [busy,setBusy]=useState(false);
 const {data:leads=[]}=useQuery({queryKey:['leads_consolidados','call-options'],queryFn:async()=>{const {data,error}=await supabase.from('leads_consolidados').select('id,nome,telefone,email').order('nome');if(error)throw error;return data??[];}});
 async function save(){
  setBusy(true);
  try {
   if(!myId && !management)throw new Error('O teu acesso não está associado a uma SDR.');
   const args={p_lead:form.lead_id||null,p_nome:form.nome_lead.trim(),p_tel:form.tel.trim(),p_email:form.email.trim(),p_agendada:new Date(form.agendada_para).toISOString(),p_closer:form.closer_id,p_sdr:management?form.sdr_id:myId,p_origem:form.origem,p_nota:form.notas||null};
   let result=await financeRpc<{id?:string;aviso?:string}>('call_marcar',args);
   if(result.aviso){if(!window.confirm(result.aviso))return;result=await financeRpc('call_marcar',{...args,p_confirmar:true});}
   await Promise.all([qc.invalidateQueries({queryKey:['calls']}),qc.invalidateQueries({queryKey:['leads_consolidados']})]);toast.success('Call marcada.');onClose();
  }catch(e){toast.error(friendlyError(e,'Não foi possível marcar a call.'));}finally{setBusy(false);}
 }
 const set=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
 return createPortal(<div className="fixed inset-0 z-[100] bg-background/80 flex items-center justify-center p-4"><form className="eda-card w-full max-w-lg space-y-3 max-h-[90dvh] overflow-y-auto" onSubmit={e=>{e.preventDefault();save();}}><div className="flex justify-between items-center"><h2 className="text-lg font-bold">Marcar call</h2><Button type="button" variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}><X/></Button></div>
 <label className="block text-sm">Lead existente (opcional)<select aria-label="Lead existente" className="eda-input" value={form.lead_id} onChange={e=>{const l=leads.find(l=>l.id===e.target.value);setForm(f=>({...f,lead_id:e.target.value,nome_lead:l?.nome||f.nome_lead,tel:l?.telefone||f.tel,email:l?.email||f.email}));}}><option value="">Novo lead</option>{leads.map(l=><option key={l.id} value={l.id}>{l.nome}</option>)}</select></label>
 <label className="block text-sm">Nome do lead<input aria-label="Nome do lead" className="eda-input" required value={form.nome_lead} onChange={e=>set('nome_lead',e.target.value)}/></label>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="block text-sm">Contacto<input aria-label="Contacto" className="eda-input" required={!form.email} value={form.tel} onChange={e=>set('tel',e.target.value)}/></label><label className="block text-sm">Email (opcional)<input aria-label="Email" type="email" className="eda-input" value={form.email} onChange={e=>set('email',e.target.value)}/></label></div>
 <label className="block text-sm">Data e hora<input aria-label="Data e hora" type="datetime-local" className="eda-input" required value={form.agendada_para} onChange={e=>set('agendada_para',e.target.value)}/></label>
 <label className="block text-sm">Closer<select aria-label="Closer" className="eda-input" required value={form.closer_id} onChange={e=>set('closer_id',e.target.value)}><option value="">Selecionar…</option>{members.filter(m=>m.ativo && (m.role==='closer'||m.id===myId)).map(m=><option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>
 {management && <label className="block text-sm">SDR<select aria-label="SDR" className="eda-input" required value={form.sdr_id} onChange={e=>set('sdr_id',e.target.value)}><option value="">Selecionar…</option>{members.filter(m=>m.ativo && (m.role==='sdr'||m.is_founder)).map(m=><option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>}
 <label className="block text-sm">Perfil de origem<select aria-label="Perfil de origem" className="eda-input" value={form.origem} onChange={e=>set('origem',e.target.value)}>{['Pablo','Leandro','EDA','outro'].map(o=><option key={o}>{o}</option>)}</select></label><label className="block text-sm">Nota<textarea className="eda-input" value={form.notas} onChange={e=>set('notas',e.target.value)}/></label><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Voltar</Button><Button type="submit" className="eda-btn" disabled={busy}>Marcar call</Button></div>
 </form></div>,document.body);
}
