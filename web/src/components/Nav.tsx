import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getMandateView } from "../api";

export function Nav() {
  const [mandateLabel, setMandateLabel] = useState("…");
  const { search } = useLocation();

  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      getMandateView().then(
        (mandate) => {
          if (active && request === latestRequest) {
            const remaining = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: mandate.currency,
            }).format(mandate.remaining);
            setMandateLabel(`${mandate.owner} — ${remaining} left`);
          }
        },
        (error: unknown) => {
          if (active && request === latestRequest) {
            const missing =
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "no_mandate";
            setMandateLabel(missing ? "No mandate" : "Mandate unavailable");
          }
        },
      );
    };
    window.addEventListener("mandate-updated", refresh);
    refresh();
    return () => {
      active = false;
      window.removeEventListener("mandate-updated", refresh);
    };
  }, []);

  return (
    <header className="site-header">
      <div className="nav-bar">
        <span className="brand">Leash</span>
        <nav className="nav-links" aria-label="Main navigation">
          <NavLink className="nav-link" to={{ pathname: "/", search }} end>
            Chat
          </NavLink>
          <NavLink className="nav-link" to={{ pathname: "/mandate", search }}>
            Mandate
          </NavLink>
          <NavLink className="nav-link" to={{ pathname: "/audit", search }}>
            Audit
          </NavLink>
        </nav>
        <span
          className="mandate-chip"
          role="status"
          aria-label={`Mandate: ${mandateLabel}`}
        >
          {mandateLabel}
        </span>
      </div>
    </header>
  );
}
