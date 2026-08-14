import { useEffect, useState } from "react";

export default function Toast({
  message,
  onClear,
}: {
  message: string;
  onClear: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onClear, 3200);
    return () => window.clearTimeout(t);
  }, [message, onClear]);

  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm shadow-xl">
      {message}
    </div>
  );
}
