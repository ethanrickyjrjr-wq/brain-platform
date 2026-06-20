import type { Metadata } from "next";
import { PhoneContactPicker } from "@/components/contacts/PhoneContactPicker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Import your contacts — SWFL Data Gulf",
  robots: { index: false, follow: false },
};

/**
 * /m/contacts/[token] — the mobile landing page a desktop QR points to.
 *
 * Public (no login): the signed token in the path IS the authorization, verified
 * server-side when the picked contacts POST to /api/email/contacts/phone. The
 * page itself just hands the token to the client picker; an invalid/expired token
 * fails closed at submit time, so we don't pre-verify here (keeps the page a
 * static shell with no secret access).
 */
export default async function MobileContactsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-lg font-semibold text-white">Add your contacts</h1>
      <p className="mt-1 text-sm text-gray-400">
        Pick the people you want to be able to email. We only read names and email addresses, and
        only the ones you choose.
      </p>
      <div className="mt-6">
        <PhoneContactPicker token={token} />
      </div>
      <p className="mt-8 text-xs text-gray-600">
        This link is tied to your account and expires shortly. If it stops working, generate a new
        QR code on your computer.
      </p>
    </main>
  );
}
