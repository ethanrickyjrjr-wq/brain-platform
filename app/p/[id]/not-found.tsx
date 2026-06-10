export default function DeliverableNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="text-lg font-medium text-gray-300">This report is no longer available.</p>
      <p className="mt-2 text-sm text-gray-500">
        The link may have been revoked by its owner, or it may never have existed. Please contact
        the sender for an updated copy.
      </p>
    </main>
  );
}
