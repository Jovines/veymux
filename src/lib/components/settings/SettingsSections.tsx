import { Children, isValidElement, useId, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal, MousePointer2, Server } from 'lucide-react';
import { useI18n } from '../../i18n';

export function SettingsSections({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0), id = useId();
  const content = useRef<HTMLDivElement>(null);
  const sections = Children.toArray(children).filter(isValidElement);
  const tabs = [
    { label: t('settings.appearanceSection'), Icon: SlidersHorizontal },
    { label: t('settings.controlsSection'), Icon: MousePointer2 },
    { label: t('settings.serviceSection'), Icon: Server },
  ];
  return <div className="flex min-h-0 flex-1 flex-col font-sans sm:flex-row">
    <nav aria-label={t('settings.title')} className="shrink-0 border-b border-border/20 p-2 sm:flex sm:w-44 sm:flex-col sm:border-b-0 sm:border-r sm:p-3">
      <div role="tablist" aria-label={t('settings.title')} className="grid grid-cols-3 gap-1 sm:grid-cols-1">
        {tabs.map(({ label, Icon }, index) => <button key={index} role="tab" type="button" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={index === active} tabIndex={index === active ? 0 : -1}
          onClick={() => { setActive(index); content.current?.scrollTo({ top: 0 }); }}
          onKeyDown={event => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : null;
            if (next === null) return;
            event.preventDefault(); setActive(next); content.current?.scrollTo({ top: 0 });
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:justify-start sm:gap-2 sm:px-3 ${index === active ? 'bg-surface-2 text-primary' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}><Icon size={17} className="shrink-0" /><span>{label}</span></button>)}
      </div>
      {footer && <div className="mt-auto hidden pt-6 sm:block">{footer}</div>}
    </nav>
    <div ref={content} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
      {sections.map((section, index) => <div key={index} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-primary">{section}</div>)}
      {footer && <div className="mt-6 sm:hidden">{footer}</div>}
    </div>
  </div>;
}
