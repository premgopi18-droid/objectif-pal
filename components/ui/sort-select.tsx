"use client";

/**
 * Le sélecteur de tri commun (#217) — même composant, mêmes libellés sur les
 * trois pages (PAL, Biblio, Journal) : le vocabulaire du tri ne se réinvente
 * pas d'un écran à l'autre. Style aligné sur les selects de filtre du Journal.
 */

const SELECT_CLASS =
  "rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

export function SortSelect<Option extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: Option;
  options: { value: Option; label: string }[];
  onChange: (option: Option) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="Trier"
      value={value}
      onChange={(event) => onChange(event.target.value as Option)}
      className={`${SELECT_CLASS} ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          Tri : {option.label}
        </option>
      ))}
    </select>
  );
}
