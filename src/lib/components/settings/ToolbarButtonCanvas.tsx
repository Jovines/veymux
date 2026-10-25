import { useEffect, useState } from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Pencil, CornerDownLeft } from 'lucide-react';
import { useI18n } from '../../i18n';
import { describeToolbarSequence } from '../../terminal/toolbarCustomization';
import {
  getToolbarActionLabel,
  splitButtonsIntoRows,
  type MobileToolbarAction,
} from '../terminal/mobileKeyboardPresets';

function ActionKey({
  action,
  index,
  disabled,
  highlighted,
  onEdit,
  onHighlight,
}: {
  action: MobileToolbarAction;
  index: number;
  disabled: boolean;
  highlighted: boolean;
  onEdit: (action: MobileToolbarAction) => void;
  onHighlight: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: action.id, disabled });
  const label = getToolbarActionLabel(action, index);
  const info = describeToolbarSequence(action.sequence);
  return (
    <div
      ref={setNodeRef}
      data-toolbar-action-key={action.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onMouseEnter={() => onHighlight(action.id)}
      onMouseLeave={() => onHighlight(null)}
      onFocusCapture={() => onHighlight(action.id)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null);
      }}
      className={`relative flex min-w-0 rounded-xl border bg-surface-2 shadow-[0_3px_0_var(--border)] ${isDragging ? 'z-20 border-primary shadow-lg ring-2 ring-primary/30' : highlighted ? 'z-10 border-primary ring-1 ring-primary' : 'border-border/40'}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        style={{ touchAction: 'none' }}
        aria-label={t('toolbarPresets.reorderAction', { name: label })}
        className="flex w-11 shrink-0 cursor-grab items-center justify-center rounded-l-xl text-muted-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary active:cursor-grabbing"
      >
        <GripVertical size={15} />
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label={t('toolbarPresets.editAction', { name: label })}
        onClick={() => onEdit(action)}
        className="group relative flex min-h-16 min-w-0 flex-1 items-center justify-center gap-1 rounded-r-xl py-3 pl-1 pr-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="truncate font-mono">{label}</span>
        {info.enter && <CornerDownLeft size={12} className="shrink-0 text-muted-foreground" />}
        <Pencil
          size={11}
          className="absolute right-2 top-2 text-muted-foreground/40 group-hover:text-primary group-focus-visible:text-primary"
        />
        {action.doubleTapSequence && (
          <span
            aria-label={t('toolbarPresets.doubleTapSummary')}
            className="absolute bottom-1 right-2 text-[9px] text-muted-foreground"
          >
            2×
          </span>
        )}
      </button>
    </div>
  );
}

export function ToolbarButtonCanvas({
  actions,
  disabled,
  highlightedId,
  onEdit,
  onAdd,
  onReorder,
  onHighlight,
}: {
  actions: MobileToolbarAction[];
  disabled: boolean;
  highlightedId: string | null;
  onEdit: (action: MobileToolbarAction) => void;
  onAdd: () => void;
  onReorder: (actions: MobileToolbarAction[]) => void;
  onHighlight: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    // Let dnd-kit cancel first, while the containing dialog keeps its layer.
    const cancelDragOnly = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    document.addEventListener('keydown', cancelDragOnly, true);
    return () => document.removeEventListener('keydown', cancelDragOnly, true);
  }, [dragging]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: 'auto',
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => {
        setDragging(true);
        onHighlight(String(event.active.id));
      }}
      onDragCancel={() => {
        setDragging(false);
        onHighlight(null);
      }}
      onDragEnd={({ active, over }) => {
        setDragging(false);
        if (over && over.id !== active.id) {
          const from = actions.findIndex((action) => action.id === active.id),
            to = actions.findIndex((action) => action.id === over.id);
          if (from >= 0 && to >= 0) onReorder(arrayMove(actions, from, to));
        }
        onHighlight(null);
      }}
    >
      <SortableContext items={actions.map((action) => action.id)} strategy={rectSortingStrategy}>
        <div
          data-toolbar-button-canvas
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
        >
          {actions.map((action, index) => (
            <ActionKey
              key={action.id}
              {...{ action, index, disabled, onEdit, onHighlight }}
              highlighted={highlightedId === action.id}
            />
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={onAdd}
            className="flex min-h-16 items-center justify-center gap-2 rounded-xl border border-dashed border-primary bg-surface px-3 text-sm font-medium text-primary hover:border-primary hover:bg-surface-2 disabled:opacity-40"
          >
            <Plus size={19} />
            {t('toolbarPresets.addButton')}
          </button>
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function ToolbarArrangement({
  value,
  count,
  onChange,
}: {
  value: number[];
  count: number;
  onChange: (value: number[]) => void;
}) {
  const { t } = useI18n();
  const custom = !(value.length === 1 && [4, 6, 8].includes(value[0]));
  const options = [
    ...(custom ? [{ layout: value, label: t('toolbarPresets.currentLayout') }] : []),
    ...[4, 6, 8].map((columns, index) => ({
      layout: [columns],
      label: t(
        index === 0
          ? 'toolbarPresets.comfortable'
          : index === 1
            ? 'toolbarPresets.balanced'
            : 'toolbarPresets.compact',
      ),
    })),
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t('toolbarPresets.arrangement')}
    >
      {options.map(({ layout, label }, index) => {
        const active = JSON.stringify(layout) === JSON.stringify(value);
        const rows = splitButtonsIntoRows(Array.from({ length: count }), layout);
        return (
          <button
            key={index}
            type="button"
            aria-pressed={active}
            aria-label={label}
            onClick={() => onChange(layout)}
            className={`flex min-h-14 w-[4.5rem] min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-lg border px-0.5 py-1.5 text-[10px] ${active ? 'border-primary bg-surface-2 text-primary' : 'border-transparent text-muted-foreground hover:bg-surface-2'}`}
          >
            <svg viewBox="0 0 72 24" aria-hidden="true" className="h-5 w-12" fill="currentColor">
              {rows
                .slice(0, 3)
                .map((row, y) =>
                  row.items.map((_, x) => (
                    <rect
                      key={`${x}-${y}`}
                      x={x * (72 / row.columns) + 1}
                      y={y * 8 + 1}
                      width={72 / row.columns - 2}
                      height={6}
                      rx={1.5}
                      opacity={active ? 0.8 : 0.45}
                    />
                  )),
                )}
            </svg>
            {label}
          </button>
        );
      })}
    </div>
  );
}
