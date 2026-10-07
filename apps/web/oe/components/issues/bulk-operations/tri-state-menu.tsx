/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Popover } from "@headlessui/react";
import { observer } from "mobx-react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";

// same shape as the options of the member, label and module dropdowns
export type TBulkTriStateOption = { value: string; query: string; content: ReactNode; disabled?: boolean };

type TTriState = "true" | "mixed" | "false";

type Props = {
  label: string;
  options: TBulkTriStateOption[];
  // number of selected work items that have this value
  getCount: (id: string) => number;
  selectedCount: number;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
  // called the first time the menu opens (load options lazily)
  onOpen?: () => void;
};

const getTriState = (count: number, selectedCount: number): TTriState => {
  if (selectedCount > 0 && count === selectedCount) return "true";
  if (count > 0) return "mixed";
  return "false";
};

function TriStateIcon({ state }: { state: TTriState }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-3.5 flex-shrink-0 place-items-center rounded-xs border", {
        "border-accent-strong bg-accent-primary text-on-color": state !== "false",
        "border-strong": state === "false",
      })}
    >
      {state === "true" && <Check className="size-2.5" strokeWidth={3} />}
      {state === "mixed" && <Minus className="size-2.5" strokeWidth={3} />}
    </span>
  );
}

/**
 * Bulk menu for a multi-value property: each value shows whether it is on every selected work item
 * (checked), on some (mixed) or on none. Clicking a checked value removes it from all; clicking a
 * mixed or unchecked value adds it to all. The menu stays open so several values can be changed.
 */
export const BulkTriStateMenu = observer(function BulkTriStateMenu(props: Props) {
  const { label, options, getCount, selectedCount, onAdd, onRemove, disabled, onOpen } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.query.toLowerCase().includes(normalizedQuery))
    : options;

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <OpenEffect open={open} onOpen={onOpen} />
          <Popover.Button
            disabled={disabled}
            aria-haspopup="menu"
            className="flex h-6 items-center gap-1.5 rounded-sm border-[0.5px] border-strong px-2 text-11 text-secondary hover:bg-layer-transparent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="truncate">{label}</span>
            <ChevronDown className="size-2.5 flex-shrink-0" aria-hidden="true" />
          </Popover.Button>
          <Popover.Panel
            data-testid="bulk-tri-state-menu"
            className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-md border-[0.5px] border-subtle bg-surface-1 p-1 shadow-raised-200"
          >
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="mb-1 w-full rounded-sm border-[0.5px] border-subtle bg-transparent px-2 py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
            />
            <div role="menu" aria-label={label} className="vertical-scrollbar max-h-48 overflow-y-auto">
              {filteredOptions.length === 0 && (
                <p className="px-2 py-1 text-11 text-placeholder italic">{t("no_matching_results")}</p>
              )}
              {filteredOptions.map((option) => {
                const state = getTriState(getCount(option.value), selectedCount);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={state}
                    disabled={disabled || option.disabled}
                    onClick={() => (state === "true" ? onRemove(option.value) : onAdd(option.value))}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-11 text-secondary hover:bg-layer-transparent-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <TriStateIcon state={state} />
                    <span className="min-w-0 flex-grow">{option.content}</span>
                  </button>
                );
              })}
            </div>
          </Popover.Panel>
        </>
      )}
    </Popover>
  );
});

/** Calls `onOpen` each time the popover opens (headless UI exposes `open` only as a render prop). */
function OpenEffect({ open, onOpen }: { open: boolean; onOpen?: () => void }) {
  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);
  return null;
}
