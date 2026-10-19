import { useState } from 'react';
import { Navigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/useAuth';
import { financeRpc } from '@/lib/finance-reporting';
import { CallForm } from '@/components/CallForm';
import { useCallsList, type CallRow } from '@/lib/calls-reporting';

const dateTime = (s: string) => new Date(s).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
const labels: Record<string,string> = { agendada:'Agendada', realizada:'Realizada', nao_compareceu:'Não compareceu', reagendada:'Reagendada', cancelada:'Cancelada' };

export function CallsWorkspace({ validate=false }: { validate?: boolean }) {
 const { data: profile } = useProfile();
 const qc = useQueryClient();
 const [formOpen,setFormOpen] = useState(false);
 const [reschedule,setReschedule] = useState<CallRow | null>(null);
 const [newTime,setNewTime] = useState('');
 const [note,setNote] = useState('');
 const [busy,setBusy] = useState(false);
 const { data: calls=[], error, isPending } = useCallsList(validate);
 const { data: members=[] } = useQuery({ queryKey:['members-directory'], queryFn:async () => { const {data,error}=await supabase.rpc('list_members_directory'); if(error) throw error; return (data ?? []) as {id:string;nome:string;role:string;ativo:boolean}[]; } });
 const names = new Map(members.map(m=>[m.id,m.nome]));
 const management=!!profile?.isGerencia;
 const myId=profile?.profile?.member_id;
 if (profile && !management && (validate ? profile.role!=='closer' : profile.role!=='sdr')) return <Navigate to={profile.role==='closer' ? '/validar-calls' : '/funil'} replace />;
 async function act(c:CallRow, estado:string, data?:string) {
  setBusy(true);
  try {
   if(!validate) await financeRpc('call_cancelar',{p_call:c.id});
   else await financeRpc('call_validar',{p_call:c.id,p_estado:estado,p_nova_data:data ? new Date(data).toISOString():null,p_nota:note || null});
   await qc.invalidateQueries({queryKey:['calls']});
   setReschedule(null); setNote(''); setNewTime(''); toast.success('Call atualizada.');
  } catch(e) { toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar a call.'); }
  finally { setBusy(false); }
 }
 return <div className="space-y-6">
  <div className="flex items-center justify-between flex-wrap gap-3"><h1 className="text-2xl font-bold flex items-center gap-2"><CalendarCheck size={20}/>{validate?'Registrar dia Closer':'Registrar dia SDR'}</h1>{!validate && <Button className="eda-btn min-h-11" onClick={()=>setFormOpen(true)}><Plus/>Adicionar</Button>}</div>
  {error && <p className="text-destructive">Não foi possível carregar as calls: {error.message}</p>}
  {validate && <h2 className="text-sm font-semibold">Por validar</h2>}
  <div className="eda-card overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="py-2">Data e hora</th><th>Lead / contacto</th><th>SDR</th><th>Closer</th><th>Origem</th><th>Estado</th><th>Ações</th></tr></thead><tbody>
   {calls.map(c=><tr key={c.id} className={`border-t border-border align-top ${c.atrasada?'text-destructive':''}`}><td className="py-3 whitespace-nowrap pr-4">{dateTime(c.agendada_para)}{c.atrasada && <div className="font-semibold text-xs">Por validar há mais de 24h</div>}</td><td className="pr-4"><div className="font-semibold">{c.nome_lead}</div><div className="text-xs">{c.tel || c.email}</div>{c.notas && <div className="text-xs text-muted-foreground max-w-64 break-words">{c.notas}</div>}</td><td className="pr-4">{names.get(c.sdr_id)||'—'}</td><td className="pr-4">{names.get(c.closer_id)||'—'}</td><td className="pr-4">{c.origem}</td><td className="pr-4">{labels[c.estado]}{c.call_seguinte_id && <div className="text-xs">Nova call: {calls.find(n=>n.id===c.call_seguinte_id) ? dateTime(calls.find(n=>n.id===c.call_seguinte_id)?.agendada_para || '') : 'ligada'}</div>}</td><td><div className="flex flex-wrap gap-2 py-2 min-w-48">
    {validate && (management || c.closer_id===myId) && <><Button disabled={busy} className="eda-btn min-h-11" onClick={()=>act(c,'realizada')}>Realizada</Button><Button disabled={busy} variant="outline" className="eda-btn-ghost min-h-11" onClick={()=>act(c,'nao_compareceu')}>Não compareceu</Button><Button disabled={busy} variant="outline" className="eda-btn-ghost min-h-11" onClick={()=>{setReschedule(c);setNewTime('');}}>Reagendar</Button><Button disabled={busy} variant="ghost" className="min-h-11" onClick={()=>act(c,'cancelada')}>Cancelada</Button></>}
    {!validate && c.estado==='agendada' && new Date(c.agendada_para)>new Date() && (management || c.sdr_id===myId) && <Button disabled={busy} variant="ghost" className="min-h-11" onClick={()=>act(c,'cancelada')}>Cancelar call</Button>}
   </div></td></tr>)}
   {!calls.length && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{isPending?'A carregar…':validate?'Sem calls por validar.':'Sem calls registadas.'}</td></tr>}
  </tbody></table></div>
  {management && <CallHistory/>}
  {formOpen && <CallForm onClose={()=>setFormOpen(false)}/>}
  {reschedule && <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-4"><form className="eda-card w-full max-w-md space-y-4" onSubmit={e=>{e.preventDefault();act(reschedule,'reagendada',newTime);}}><h2 className="text-lg font-bold">Reagendar · {reschedule.nome_lead}</h2><label className="block text-sm">Nova data e hora<input aria-label="Nova data e hora" className="eda-input mt-1" type="datetime-local" required value={newTime} onChange={e=>setNewTime(e.target.value)}/></label><label className="block text-sm">Nota<textarea className="eda-input" value={note} onChange={e=>setNote(e.target.value)}/></label><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={()=>setReschedule(null)}>Voltar</Button><Button type="submit" className="eda-btn" disabled={busy}>Reagendar</Button></div></form></div>}
 </div>;
}
function CallHistory() {
 const {data:rows=[]}=useQuery({queryKey:['calls','history'],queryFn:async()=>{const {data,error}=await supabase.from('calls_hist').select('id,call_id,actor_id,acao,campos,created_at').order('created_at',{ascending:false}).limit(100);if(error)throw error;return data??[];}});
 return <details><summary className="cursor-pointer text-sm font-semibold">Histórico de calls</summary><div className="eda-card overflow-x-auto mt-3"><table className="w-full text-xs"><thead><tr className="text-left"><th>Quando</th><th>Call</th><th>Quem</th><th>Alteração</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t border-border"><td className="py-2">{dateTime(r.created_at)}</td><td>{r.call_id}</td><td>{r.actor_id}</td><td>{r.acao} · {r.campos?.join(', ')}</td></tr>)}</tbody></table></div></details>;
}
