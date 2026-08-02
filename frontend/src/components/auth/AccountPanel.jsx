import { useEffect, useState } from "react";
import { LogIn, LogOut, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";

export default function AccountPanel({ access, openSignal = 0 }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  const sendLink = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await access.sendMagicLink(email.trim());
      toast.success("Check your email for the secure sign-in link.");
      setOpen(false);
    } catch (error) {
      toast.error(error.message || "Could not send sign-in email.");
    } finally {
      setSending(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await access.signOut();
      toast.success("Signed out");
      setOpen(false);
    } catch (error) {
      toast.error(error.message || "Could not sign out.");
    }
  };

  if (!access.configured) {
    return <span className="hidden sm:inline text-xs font-bold text-[#64748B]">Account setup pending</span>;
  }

  const planLabel = access.isPro ? "Coach Brain Pro" : "Free plan";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 border border-[#003366] px-3 py-2 text-xs font-bold text-[#003366] hover:bg-[#003366] hover:text-white"
      >
        {access.user ? <UserRound className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
        {access.loading ? "Checking…" : planLabel}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 border border-[#CBD5E1] bg-white p-4 text-left shadow-xl">
          {access.user ? (
            <>
              <div className="label-eyebrow">Signed in</div>
              <p className="mt-2 break-all text-sm font-bold text-[#0F172A]">{access.user.email}</p>
              <p className="mt-2 text-xs leading-relaxed text-[#475569]">
                {access.isPro
                  ? "Your Pro access is active on this account."
                  : "This account is on the Free plan. Purchased accounts are activated after the receipt is checked."}
              </p>
              <button type="button" onClick={handleSignOut} className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#003366] hover:underline">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </>
          ) : (
            <form onSubmit={sendLink}>
              <div className="label-eyebrow">Sign in or create account</div>
              <p className="mt-2 text-xs leading-relaxed text-[#475569]">We will email a secure sign-in link. Use the same email address as your purchase.</p>
              <label className="sr-only" htmlFor="account-email">Email address</label>
              <input
                id="account-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="coach@example.com"
                className="mt-3 h-10 w-full border border-[#CBD5E1] px-3 text-sm outline-none focus:border-[#003366]"
              />
              <button disabled={sending} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 bg-[#003366] px-3 text-xs font-bold text-white hover:bg-[#002244] disabled:opacity-60">
                <Mail className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
