export function FrozenSnapshotNote({ filedAt }: { filedAt: string }) {
  const d = filedAt.slice(0, 10);
  return (
    <p className="mt-1 text-[11px] text-gray-500 italic">
      This is the file you provided on {d}; we can&apos;t refresh it automatically.
    </p>
  );
}
