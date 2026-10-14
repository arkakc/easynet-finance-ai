"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { erpActionAppearance, type ErpAction } from "@/lib/ui/erp-action-standards";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  action: ErpAction;
  children?: ReactNode;
  confirmMessage?: string;
};

/** UI confirmation is an additional safeguard, never a replacement for server-side validation. */
export default function ErpActionButton({ action, children, confirmMessage, onClick, className = "", disabled, ...rest }: Props) {
  const design = erpActionAppearance[action];
  return <button
    {...rest}
    type={rest.type ?? "button"}
    disabled={disabled}
    className={`ef-erp-action ef-erp-action-${design.tone} ${className}`.trim()}
    onClick={event => {
      if (disabled) return;
      if (confirmMessage && !window.confirm(confirmMessage)) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    }}
  >{children ?? design.label}</button>;
}
