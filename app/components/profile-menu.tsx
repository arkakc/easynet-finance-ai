"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  userName: string;
  userRoles: string[];
};

export default function ProfileMenu({ userName, userRoles }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = userName?.trim()?.charAt(0)?.toUpperCase() || "U";

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-menu-wrap" ref={rootRef}>
      <button
        type="button"
        className="profile-avatar-button"
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="profile-avatar-circle" aria-hidden="true">{initial}</span>
      </button>

      {open ? (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-user">
            <span className="profile-dropdown-avatar" aria-hidden="true">{initial}</span>
            <div className="profile-dropdown-copy">
              <strong>{userName}</strong>
              <span>{userRoles.join(", ")}</span>
            </div>
          </div>
          <div className="profile-dropdown-divider" />
          <button
            type="button"
            className="profile-signout-button"
            role="menuitem"
            disabled={busy}
            onClick={signOut}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
