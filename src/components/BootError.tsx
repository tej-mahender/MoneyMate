import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { db } from "../db/db";
import { exportFullBackup, downloadFile } from "../lib/csv";
import { todayISO } from "../lib/format";

/** Shown instead of an endless skeleton when the app can't open its local
 *  database on launch (blocked, storage full, failed migration, or just too
 *  slow). Gives the person three ways out: retry, save whatever can still be
 *  read, or — as a last resort — reset local data. */
export default function BootError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function saveBackup() {
    setBusy(true);
    setStatus(null);
    try {
      await downloadFile(
        `moneymate-backup-${todayISO()}.json`,
        await exportFullBackup(),
        "application/json",
      );
      setStatus("Backup ready.");
    } catch {
      setStatus("Couldn't read your data to back it up.");
    } finally {
      setBusy(false);
    }
  }

  async function resetData() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setBusy(true);
    try {
      await db.delete();
      location.reload();
    } catch {
      setStatus("Couldn't reset. Try closing and reopening the app.");
      setBusy(false);
      setConfirmReset(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="content" style={{ paddingTop: 70, textAlign: "center" }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            background: "var(--over-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
          }}
        >
          <AlertTriangle size={28} color="var(--over)" />
        </div>
        <h1
          style={{ fontFamily: "var(--display)", fontSize: 22, margin: "0 0 10px" }}
        >
          Couldn't open your data
        </h1>
        <p className="muted" style={{ maxWidth: 320, margin: "0 auto 8px" }}>
          Money Mate couldn't open its storage on this device. Your data hasn't
          been deleted. Try again first.
        </p>
        <p
          className="muted"
          style={{ maxWidth: 320, margin: "0 auto", fontSize: 12 }}
        >
          {message}
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          <button className="btn" onClick={onRetry} disabled={busy}>
            Try again
          </button>
          <button className="btn secondary" onClick={saveBackup} disabled={busy}>
            Save a backup
          </button>
        </div>

        {status && (
          <p role="status" className="muted" style={{ marginTop: 14 }}>
            {status}
          </p>
        )}

        <div className="danger-zone" style={{ marginTop: 28 }}>
          <button className="btn danger" onClick={resetData} disabled={busy}>
            {confirmReset ? "Tap again to erase everything" : "Reset app data"}
          </button>
        </div>
      </div>
    </div>
  );
}
