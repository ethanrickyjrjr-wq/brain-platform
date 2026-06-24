import { cn } from "@/lib/utils";

type Width = "narrow" | "content" | "wide";

const widths: Record<Width, string> = {
  narrow: "mx-auto max-w-2xl px-4 sm:px-6",
  content: "mx-auto max-w-4xl px-6 sm:px-8",
  wide: "mx-auto max-w-6xl px-6 sm:px-8",
};

interface PageShellProps {
  children: React.ReactNode;
  width?: Width;
  className?: string;
}

export function PageShell({ children, width = "content", className }: PageShellProps) {
  return <main className={cn(widths[width], "py-10", className)}>{children}</main>;
}
