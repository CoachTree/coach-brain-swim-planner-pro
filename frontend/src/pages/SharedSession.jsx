import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Waves, ArrowLeft } from "lucide-react";
import SessionResult from "@/components/swim/SessionResult";
import { decodeShare, isExpired, expiresOn, SHARE_TTL_DAYS } from "@/lib/shareLink";

/**
 * Read-only shared session page. Reads data from the URL hash (#<base64>).
 * No backend required — works on any static host.
 *
 * Expiry is embedded in the encoded payload (created_at + ttl_days).
 */
export default function SharedSession() {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    try {
      const hash = new URLSearchParams(window.location.hash.split("?")[1] || "").get("data");
      if (!hash) {
        setState({ loading: false, data: null, error: "No shared session in this URL." });
        return;
      }
      const data = decodeShare(hash);
      if (isExpired(data.created_at, data.ttl_days || SHARE_TTL_DAYS)) {
        setState({ loading: false, data: null, error: "This shared session has expired." });
        return;
      }
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({
        loading: false,
        data: null,
        error: "Could not read this shared session — the link may be malformed.",
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-white" data-testid="shared-session-page">
      <header className="border-b border-[#CBD5E1] bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3" data-testid="back-link">
            <div className="h-10 w-10 bg-[#003366] flex items-center justify-center rounded-sm">
              <Waves className="h-5 w-5 text-[#00E5FF]" strokeWidth={2.5} />
            </div>
            <div>
              <div className="label-eyebrow">Coach Brain · Swim</div>
              <h1 className="font-display text-xl font-black tracking-tight text-[#0F172A] leading-none mt-1">
                Shared session
              </h1>
            </div>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm font-bold text-[#003366]"
          >
            <ArrowLeft className="h-4 w-4" /> Build a new one
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-10">
        {state.loading && (
          <div className="text-[#475569]" data-testid="shared-loading">
            Loading shared session…
          </div>
        )}
        {state.error && (
          <div
            className="border border-[#FF3B30] bg-[#FFF1F0] text-[#FF3B30] p-5 rounded-sm"
            data-testid="shared-error"
          >
            <div className="font-display font-bold text-lg mb-1">Unavailable</div>
            <p className="text-sm">{state.error}</p>
          </div>
        )}
        {state.data && (
          <>
            <p className="text-sm text-[#475569] mb-4" data-testid="shared-meta">
              Shared on{" "}
              {new Date(state.data.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "2-digit",
              })}
              {" · "}Expires{" "}
              {expiresOn(state.data.created_at)?.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "2-digit",
              })}
            </p>
            <SessionResult
              originalSession={state.data.session}
              profile={state.data.profile}
              readOnly
              hideShare
            />
          </>
        )}
      </main>

      <footer className="border-t border-[#CBD5E1] mt-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 label-eyebrow">
          Coach Brain Swim Planner Pro · shared session
        </div>
      </footer>
    </div>
  );
}
