import { createFileRoute } from '@tanstack/react-router';
import { CallsWorkspace } from '@/components/CallsWorkspace';
export const Route=createFileRoute('/_authenticated/validar-calls')({component:()=> <CallsWorkspace validate/>});
