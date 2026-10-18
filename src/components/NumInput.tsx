import { useEffect, useState } from "react";

// Input numérico sem o bug do "0" travado.
// Mostra placeholder quando vazio; permite apagar livremente; devolve 0 ao onChange
// quando o campo estiver vazio (apenas no momento em que o utilizador acaba a
// digitação — durante a edição o valor visual pode ficar "").
type Props = {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  min?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function NumInput({
  value,
  onChange,
  step = "1",
  min = 0,
  placeholder = "0",
  className,
  disabled,
}: Props) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));

  useEffect(() => {
    // Sincroniza se o valor mudar externamente (ex: reset da secção).
    const asNum = text === "" ? 0 : Number(text);
    if (asNum !== value) {
      setText(value === 0 ? "" : String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      pattern="[0-9.,]*"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      className={className ?? "eda-input w-full"}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        // permitir apenas números, ponto e vazio
        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        if (raw === "") onChange(0);
        else {
          const n = Number(raw);
          if (!Number.isNaN(n) && n >= min) onChange(n);
        }
      }}
      onBlur={() => {
        // normalizar: "" fica "" (mostra placeholder), senão mostra o número parsed
        if (text === "" || text === ".") return;
        const n = Number(text);
        if (!Number.isNaN(n)) setText(String(n));
      }}
      step={step}
    />
  );
}
