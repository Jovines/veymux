import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';

/** Short, mutually exclusive choices: show both the alternatives and the result. */
export function ConfigurationChoices<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode; detail?: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <legend className="mb-2 text-sm text-muted-foreground">{label}</legend>
    <div className="flex flex-wrap gap-2">
      {options.map(option => <label key={option.value} className={`relative flex min-h-16 min-w-0 max-w-full flex-[1_1_6rem] cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 ${value === option.value ? 'border-primary bg-surface-2 text-foreground' : 'border-border/30 text-muted-foreground hover:bg-surface-2'}`}>
        <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
        {option.icon && <span aria-hidden="true" className={value === option.value ? 'shrink-0 text-primary' : 'shrink-0'}>{option.icon}</span>}
        <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{option.label}</span>{option.detail && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.detail}</span>}</span>
        {value === option.value && <Check size={13} aria-hidden="true" className="absolute right-1.5 top-1.5 text-primary" />}
      </label>)}
    </div>
  </fieldset>;
}
