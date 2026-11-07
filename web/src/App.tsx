import React, { useState } from "react";
import { MandatePage } from "./pages/MandatePage";
import { ChatPage } from "./pages/ChatPage";
import { AuditPage } from "./pages/AuditPage";

type Tab = "mandate" | "chat" | "audit";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("mandate");

  return (
    <div style={{ fontFamily: "sans-serif", color: "#111" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 2rem",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#ffffff",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
          Leash
        </h1>
        <nav style={{ display: "flex", gap: "1rem" }}>
          <button
            type="button"
            onClick={() => setActiveTab("mandate")}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: activeTab === "mandate" ? "#0070ba" : "#f3f4f6",
              color: activeTab === "mandate" ? "#ffffff" : "#111827",
            }}
          >
            Mandate
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: activeTab === "chat" ? "#0070ba" : "#f3f4f6",
              color: activeTab === "chat" ? "#ffffff" : "#111827",
            }}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: activeTab === "audit" ? "#0070ba" : "#f3f4f6",
              color: activeTab === "audit" ? "#ffffff" : "#111827",
            }}
          >
            Audit
          </button>
        </nav>
      </header>
      <main>
        {activeTab === "mandate" && <MandatePage />}
        {activeTab === "chat" && <ChatPage />}
        {activeTab === "audit" && <AuditPage />}
      </main>
    </div>
  );
};
