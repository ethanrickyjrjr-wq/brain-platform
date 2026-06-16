"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-gray-400">Something went wrong.</p>
      <button
        onClick={reset}
        className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-gray-300 hover:border-white/40 hover:text-white"
      >
        Try again
      </button>
    </div>
  );
}
