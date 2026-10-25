import { splitProps, type JSX } from "solid-js";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "glass" | "ink" | "accent" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  active?: boolean;
  /** Tooltip text; `shortcut` is shown next to it. */
  tip?: string;
  shortcut?: string;
}

function classes(p: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; class?: string }, extra = "") {
  return [
    "umi-btn",
    `umi-btn--${p.variant ?? "glass"}`,
    p.size && p.size !== "md" ? `umi-btn--${p.size}` : "",
    p.block ? "umi-btn--block" : "",
    extra,
    p.class ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "block", "active", "tip", "shortcut", "class", "children"]);
  const button = (
    <button type="button" class={classes(local)} data-active={local.active ? "true" : undefined} {...rest}>
      {local.children}
    </button>
  );
  return local.tip ? <Tooltip text={local.tip} shortcut={local.shortcut}>{button}</Tooltip> : button;
}

export interface IconButtonProps extends ButtonProps {
  /** Accessible name (also the tooltip unless `tip` is set). */
  label: string;
}

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "label", "tip", "shortcut", "active", "class", "children"]);
  const button = (
    <button
      type="button"
      aria-label={local.label}
      class={classes({ variant: local.variant ?? "ghost", size: local.size, class: local.class }, "umi-icon-btn")}
      data-active={local.active ? "true" : undefined}
      {...rest}
    >
      {local.children}
    </button>
  );
  return <Tooltip text={local.tip ?? local.label} shortcut={local.shortcut}>{button}</Tooltip>;
}
