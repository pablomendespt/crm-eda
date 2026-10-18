import { useState } from "react";

export function Avatar({ nome, foto, size = 40, className = "" }: { nome: string; foto?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = nome.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  return (
    <span
      className={`avatar-root shrink-0 overflow-hidden rounded-full inline-flex items-center justify-center font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.34)) }}
      aria-label={`Fotografia de ${nome}`}
    >
      {foto && !failed ? (
        <img src={foto} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : initials}
    </span>
  );
}
