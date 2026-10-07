/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";
// helpers
import { cn } from "../utils";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
  iconClassName?: string;
  indeterminate?: boolean;
}

const Checkbox = React.forwardRef(function Checkbox(props: CheckboxProps, ref: React.ForwardedRef<HTMLInputElement>) {
  const {
    id,
    name,
    checked,
    indeterminate = false,
    disabled,
    containerClassName,
    iconClassName,
    className,
    ...rest
  } = props;
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  // `indeterminate` only exists as a DOM property: set it so assistive technologies and `:indeterminate` see it.
  // Re-applied on every render because a native click resets it.
  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  });

  return (
    <div className={cn("relative flex flex-shrink-0 gap-2", containerClassName)}>
      <input
        id={id}
        ref={inputRef}
        type="checkbox"
        name={name}
        checked={checked}
        className={cn(
          "size-4 shrink-0 cursor-pointer appearance-none rounded-[3px] border focus:outline-1 focus:outline-offset-4 focus:outline-accent-strong",
          {
            "cursor-not-allowed border-subtle bg-layer-1": disabled,
            "border-strong bg-transparent hover:border-strong-1": !disabled,
            "border-accent-strong-40 hover:border-accent-strong-40 bg-accent-primary hover:bg-accent-primary/80":
              !disabled && (checked || indeterminate),

            "border-none": checked,
          },
          className
        )}
        disabled={disabled}
        {...rest}
      />
      <svg
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 hidden size-4 -translate-x-1/2 -translate-y-1/2 p-0.5 text-on-color outline-none",
          {
            block: checked,
            "text-placeholder opacity-40": disabled,
          },
          iconClassName
        )}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <svg
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 hidden size-4 -translate-x-1/2 -translate-y-1/2 stroke-white p-0.5 outline-none",
          {
            "stroke-placeholder opacity-40": disabled,
            block: indeterminate && !checked,
          },
          iconClassName
        )}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.75 4H2.25" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});
Checkbox.displayName = "form-checkbox-field";

export { Checkbox };
