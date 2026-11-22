import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  const variantStyles = {
    default: "bg-primary text-primary-foreground font-bold hover:brightness-95 active:brightness-90",
    destructive: "bg-destructive text-destructive-foreground font-extrabold hover:bg-destructive/90",
    outline: "border-2 border-foreground bg-transparent text-foreground font-bold hover:bg-secondary",
    secondary: "bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/80",
    ghost: "text-muted-foreground font-medium hover:bg-secondary hover:text-foreground",
    link: "text-ink font-semibold underline-offset-4 hover:underline",
  }[variant];

  const sizeStyles = {
    default: "h-10 rounded-xl px-4 text-sm",
    sm: "h-8 rounded-lg px-3 text-xs",
    lg: "h-12 rounded-[14px] px-6 text-[15px]",
    icon: "h-10 w-10 rounded-xl p-0",
  }[size];

  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 btn-tactile cursor-pointer select-none",
        variantStyles,
        sizeStyles,
        className
      )}
      {...props}
    />
  );
}
